import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase, dbRun, dbGet, dbAll } from './database.js';
import { generatePixPayload, generatePixQRCodeDataURL } from './pix.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Suporte a fotos em Base64
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir arquivos estáticos do frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper de ID único
const uid = (prefix = 'id') => `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

// Helper para obter IP do cliente
const getClientIp = (req) => {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1 (Localhost)';
};

// Helper para registrar log de auditoria
async function logAudit({ userId, username, action, description, details, ip, lat, lng, locationText }) {
  try {
    const logId = uid('log');
    await dbRun(`
      INSERT INTO audit_logs (id, user_id, username, action, description, details_json, ip_address, latitude, longitude, location_text, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
    `, [
      logId,
      userId || 'anonymous',
      username || 'Visitante',
      action,
      description,
      details ? JSON.stringify(details) : null,
      ip || '127.0.0.1',
      lat || null,
      lng || null,
      locationText || 'Localização não informada'
    ]);
  } catch (err) {
    console.error('[AuditLog] Erro ao gravar log:', err.message);
  }
}

// =========================================================================
// 1. ROTAS DE AUTENTICAÇÃO E PERFIL DO TÉCNICO
// =========================================================================

// Login com verificação de credenciais e registro de acesso com geolocalização
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password, latitude, longitude, locationText } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
    }

    const user = await dbGet('SELECT * FROM users WHERE username = ? COLLATE BINARY', [username.trim()]);

    if (!user || user.username !== username.trim() || user.password !== password) {
      // Registrar tentativa falha no log de auditoria
      await logAudit({
        userId: user ? user.id : 'unknown',
        username: username,
        action: 'LOGIN_FAILED',
        description: `Tentativa de login inválida para o usuário '${username}'.`,
        ip: getClientIp(req),
        lat: latitude,
        lng: longitude,
        locationText: locationText
      });
      return res.status(401).json({ error: 'Credenciais inválidas. Verifique se digitou o usuário e a senha respeitando letras maiúsculas e minúsculas exatamente.' });
    }

    // Registrar sucesso de login no log de auditoria com geolocalização e data/hora
    await logAudit({
      userId: user.id,
      username: user.username,
      action: 'LOGIN_SUCCESS',
      description: `Técnico responsável '${user.name}' (${user.role.toUpperCase()}) autenticado com sucesso no sistema.`,
      details: { role: user.role, registration: user.registration_number },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText: locationText || 'Terminal Local'
    });

    // Buscar sessão salva anteriormente para restaurar o ponto de onde parou
    const savedSession = await dbGet('SELECT * FROM user_sessions WHERE user_id = ?', [user.id]);

    // Retornar usuário sem a senha
    const { password: _, ...userSafe } = user;
    res.json({
      user: userSafe,
      savedSession: savedSession ? {
        currentTab: savedSession.current_tab,
        currentCompanyId: savedSession.current_company_id,
        draftState: savedSession.draft_state_json ? JSON.parse(savedSession.draft_state_json) : null,
        lastActiveAt: savedSession.last_active_at
      } : null
    });
  } catch (err) {
    console.error('[Auth/Login] Erro:', err);
    res.status(500).json({ error: 'Erro interno ao processar login: ' + err.message });
  }
});

// Atualizar Perfil do Técnico
app.put('/api/auth/profile', async (req, res) => {
  try {
    const { userId, name, registrationNumber, email, phone, newPassword, latitude, longitude, locationText } = req.body;

    if (!userId) return res.status(400).json({ error: 'ID de usuário não informado.' });

    const user = await dbGet('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const updatedPassword = newPassword && newPassword.trim() ? newPassword.trim() : user.password;

    await dbRun(`
      UPDATE users 
      SET name = ?, registration_number = ?, email = ?, phone = ?, password = ?
      WHERE id = ?
    `, [
      name || user.name,
      registrationNumber || user.registration_number,
      email || user.email,
      phone || user.phone,
      updatedPassword,
      userId
    ]);

    await logAudit({
      userId,
      username: user.username,
      action: 'PROFILE_UPDATED',
      description: `Perfil do técnico responsável '${name || user.name}' atualizado.`,
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    const updatedUser = await dbGet('SELECT id, username, name, role, registration_number, email, phone, created_at FROM users WHERE id = ?', [userId]);
    res.json({ success: true, user: updatedUser });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar perfil: ' + err.message });
  }
});

// Logout e registro de encerramento de sessão
app.post('/api/auth/logout', async (req, res) => {
  try {
    const { userId, username, latitude, longitude, locationText } = req.body;
    await logAudit({
      userId,
      username,
      action: 'LOGOUT',
      description: `Usuário '${username || 'Técnico'}' encerrou a sessão no sistema.`,
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });
    res.json({ success: true, message: 'Sessão encerrada com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar todos os usuários/técnicos cadastrados
app.get('/api/users', async (req, res) => {
  try {
    const users = await dbAll('SELECT id, username, name, role, registration_number, email, phone, created_at FROM users ORDER BY created_at ASC');
    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cadastrar novo usuário/técnico
app.post('/api/users', async (req, res) => {
  try {
    const { username, password, name, role, registrationNumber, email, phone, authorId, authorName } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Usuário, senha e nome são obrigatórios.' });
    }

    const existing = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username.trim()]);
    if (existing) {
      return res.status(400).json({ error: `O usuário '${username}' já existe no sistema.` });
    }

    const newId = uid('usr');
    await dbRun(`
      INSERT INTO users (id, username, password, name, role, registration_number, email, phone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      newId,
      username.trim(),
      password.trim(),
      name.trim(),
      role || 'technician',
      registrationNumber || 'MTE-SST-PENDENTE',
      email || `${username.toLowerCase()}@sstpro.com.br`,
      phone || '(11) 98765-0000'
    ]);

    await logAudit({
      userId: authorId || newId,
      username: authorName || username,
      action: 'USER_CREATED',
      description: `Novo acesso de técnico criado: '${username.trim()}' (${name.trim()}).`
    });

    const created = await dbGet('SELECT id, username, name, role, registration_number, email, phone, created_at FROM users WHERE id = ?', [newId]);
    res.json({ success: true, user: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 2. PERSISTÊNCIA DE SESSÃO / ONDE PAROU
// =========================================================================

app.get('/api/session/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const session = await dbGet('SELECT * FROM user_sessions WHERE user_id = ?', [userId]);
    if (!session) return res.json({ session: null });
    res.json({
      session: {
        currentTab: session.current_tab,
        currentCompanyId: session.current_company_id,
        draftState: session.draft_state_json ? JSON.parse(session.draft_state_json) : null,
        lastActiveAt: session.last_active_at
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/session/save', async (req, res) => {
  try {
    const { userId, currentTab, currentCompanyId, draftState } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId obrigatório' });

    const draftJson = draftState ? JSON.stringify(draftState) : null;
    await dbRun(`
      INSERT INTO user_sessions (user_id, current_tab, current_company_id, draft_state_json, last_active_at)
      VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(user_id) DO UPDATE SET
        current_tab = excluded.current_tab,
        current_company_id = excluded.current_company_id,
        draft_state_json = excluded.draft_state_json,
        last_active_at = datetime('now', 'localtime')
    `, [userId, currentTab || 'empresas', currentCompanyId || null, draftJson]);

    res.json({ success: true, message: 'Estado da sessão salvo com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 3. ROTAS DE EMPRESAS & CONSULTA AUTOMÁTICA DE CNPJ
// =========================================================================

// Consulta online automática de CNPJ na Receita Federal
app.get('/api/cnpj/lookup/:cnpj', async (req, res) => {
  try {
    const { cnpj } = req.params;
    const clean = String(cnpj || '').replace(/\D/g, '');

    if (clean.length !== 14) {
      return res.status(400).json({ error: 'CNPJ deve conter 14 dígitos numéricos.' });
    }

    // 1. Tentar MinhaReceita
    try {
      const response = await fetch(`https://minhareceita.org/${clean}`, { signal: AbortSignal.timeout(4500) });
      if (response.ok) {
        const d = await response.json();
        const nomePrincipal = d.razao_social || d.nome_fantasia || '';
        const logradouroFormatado = d.descricao_tipo_de_logradouro 
          ? `${d.descricao_tipo_de_logradouro} ${d.logradouro}` 
          : d.logradouro;

        const enderecoPartes = [
          logradouroFormatado,
          d.numero ? `nº ${d.numero}` : '',
          d.complemento ? `(${d.complemento})` : '',
          d.bairro ? `${d.bairro}` : '',
          d.municipio ? `${d.municipio} - ${d.uf}` : '',
          d.cep ? `CEP ${d.cep}` : ''
        ].filter(Boolean).join(', ');

        return res.json({
          success: true,
          source: 'MinhaReceita',
          cnpj: d.cnpj,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia,
          nome: nomePrincipal,
          endereco: enderecoPartes || [d.logradouro, d.municipio, d.uf].filter(Boolean).join(', '),
          bairro: d.bairro,
          cidade: d.municipio,
          uf: d.uf,
          cep: d.cep,
          porte: d.porte ? (d.porte.toUpperCase().includes('ME') || d.porte.toUpperCase().includes('MICRO') || d.porte.toUpperCase().includes('EPP') ? 'pequeno' : 'medio_grande') : 'pequeno',
          situacao: d.descricao_situacao_cadastral,
          cnae: d.cnae_fiscal_descricao
        });
      }
    } catch (e) {
      // Fallback para próxima API
    }

    // 2. Tentar BrasilAPI
    try {
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${clean}`, { signal: AbortSignal.timeout(4500) });
      if (response.ok) {
        const d = await response.json();
        const nomePrincipal = d.razao_social || d.nome_fantasia || '';
        const logradouroFormatado = d.descricao_tipo_de_logradouro 
          ? `${d.descricao_tipo_de_logradouro} ${d.logradouro}` 
          : d.logradouro;

        const enderecoPartes = [
          logradouroFormatado,
          d.numero ? `nº ${d.numero}` : '',
          d.complemento ? `(${d.complemento})` : '',
          d.bairro ? `${d.bairro}` : '',
          d.municipio ? `${d.municipio} - ${d.uf}` : '',
          d.cep ? `CEP ${d.cep}` : ''
        ].filter(Boolean).join(', ');

        return res.json({
          success: true,
          source: 'BrasilAPI',
          cnpj: d.cnpj,
          razaoSocial: d.razao_social,
          nomeFantasia: d.nome_fantasia,
          nome: nomePrincipal,
          endereco: enderecoPartes || [d.logradouro, d.municipio, d.uf].filter(Boolean).join(', '),
          bairro: d.bairro,
          cidade: d.municipio,
          uf: d.uf,
          cep: d.cep,
          porte: d.porte ? (d.porte.toUpperCase().includes('ME') || d.porte.toUpperCase().includes('MICRO') || d.porte.toUpperCase().includes('EPP') ? 'pequeno' : 'medio_grande') : 'pequeno',
          situacao: d.descricao_situacao_cadastral,
          cnae: d.cnae_fiscal_descricao
        });
      }
    } catch (e) {
      // Fallback
    }

    res.status(404).json({ error: 'CNPJ não localizado nas bases públicas da Receita Federal.' });
  } catch (err) {
    console.error('[CnpjLookup] Erro:', err);
    res.status(500).json({ error: 'Erro ao consultar CNPJ: ' + err.message });
  }
});

app.get('/api/companies', async (req, res) => {
  try {
    const { userId } = req.query;
    let sql = 'SELECT * FROM companies';
    let params = [];
    if (userId) {
      sql += ' WHERE user_id = ?';
      params.push(userId);
    }
    sql += ' ORDER BY created_at DESC';
    const companies = await dbAll(sql, params);
    res.json({ companies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/companies', async (req, res) => {
  try {
    const { name, cnpj, porte, valorMensalidade, endereco, responsavel, emailContato, telefoneContato, userId, username, latitude, longitude, locationText } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Razão social da empresa é obrigatória.' });
    }

    const companyId = uid('comp');
    const valor = valorMensalidade || (porte === 'pequeno' ? 2500 : 1500);

    await dbRun(`
      INSERT INTO companies (id, user_id, name, cnpj, porte, valor_mensalidade, endereco, responsavel, email_contato, telefone_contato)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [companyId, userId || null, name.trim(), cnpj || '', porte || 'pequeno', valor, endereco || '', responsavel || '', emailContato || '', telefoneContato || '']);

    await logAudit({
      userId,
      username,
      action: 'COMPANY_CREATED',
      description: `Nova empresa cadastrada: '${name.trim()}' (${porte === 'pequeno' ? 'Pequeno Porte' : 'Médio/Grande Porte'}).`,
      details: { companyId, name: name.trim(), porte, valor },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    const newCompany = await dbGet('SELECT * FROM companies WHERE id = ?', [companyId]);
    res.status(201).json({ company: newCompany });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/companies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, username } = req.body;
    const comp = await dbGet('SELECT * FROM companies WHERE id = ?', [id]);
    if (!comp) return res.status(404).json({ error: 'Empresa não encontrada.' });

    await dbRun('DELETE FROM companies WHERE id = ?', [id]);

    await logAudit({
      userId,
      username,
      action: 'COMPANY_DELETED',
      description: `Empresa '${comp.name}' removida do sistema com todo seu histórico.`,
      ip: getClientIp(req)
    });

    res.json({ success: true, message: 'Empresa removida com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 4. ROTAS DE ALMOXARIFADO / ESTOQUE DE EPI
// =========================================================================

app.get('/api/inventory', async (req, res) => {
  try {
    const { empresaId } = req.query;
    let sql = 'SELECT * FROM inventory_materials';
    let params = [];
    if (empresaId) {
      sql += ' WHERE empresa_id = ?';
      params.push(empresaId);
    }
    sql += ' ORDER BY identificacao ASC';
    const materials = await dbAll(sql, params);
    res.json({ materials });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const { empresaId, identificacao, caNumber, categoria, quantidadeDisponivel, estoqueMinimo, unidade, fornecedor, userId, username, latitude, longitude, locationText } = req.body;

    if (!empresaId || !identificacao || identificacao.trim() === '') {
      return res.status(400).json({ error: 'Empresa e identificação do material são obrigatórios.' });
    }

    const materialId = uid('mat');
    const qtd = Number(quantidadeDisponivel) || 0;
    const minEstoque = Number(estoqueMinimo) || 5;

    await dbRun(`
      INSERT INTO inventory_materials (id, empresa_id, identificacao, ca_number, categoria, quantidade_disponivel, estoque_minimo, unidade, fornecedor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [materialId, empresaId, identificacao.trim(), caNumber || 'CA N/I', categoria || 'Geral', qtd, minEstoque, unidade || 'un', fornecedor || '']);

    await logAudit({
      userId,
      username,
      action: 'INVENTORY_ITEM_CREATED',
      description: `EPI cadastrado no almoxarifado: '${identificacao.trim()}' (${qtd} ${unidade || 'un'}, ${caNumber || 'S/ CA'}).`,
      details: { materialId, empresaId, quantidadeDisponivel: qtd },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    const newMaterial = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [materialId]);
    res.status(201).json({ material: newMaterial });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { identificacao, caNumber, categoria, quantidadeDisponivel, estoqueMinimo, unidade, userId, username } = req.body;

    const existing = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Material não encontrado.' });

    const newQtd = quantidadeDisponivel !== undefined ? Number(quantidadeDisponivel) : existing.quantidade_disponivel;

    await dbRun(`
      UPDATE inventory_materials 
      SET identificacao = ?, ca_number = ?, categoria = ?, quantidade_disponivel = ?, estoque_minimo = ?, unidade = ?
      WHERE id = ?
    `, [
      identificacao || existing.identificacao,
      caNumber || existing.ca_number,
      categoria || existing.categoria,
      newQtd,
      estoqueMinimo !== undefined ? Number(estoqueMinimo) : existing.estoque_minimo,
      unidade || existing.unidade,
      id
    ]);

    await logAudit({
      userId,
      username,
      action: 'INVENTORY_ITEM_UPDATED',
      description: `EPI '${existing.identificacao}' atualizado. Estoque: ${existing.quantidade_disponivel} -> ${newQtd} ${unidade || existing.unidade}.`,
      ip: getClientIp(req)
    });

    const updated = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [id]);
    res.json({ material: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, username } = req.body;
    const existing = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Material não encontrado.' });

    await dbRun('DELETE FROM inventory_materials WHERE id = ?', [id]);

    await logAudit({
      userId,
      username,
      action: 'INVENTORY_ITEM_DELETED',
      description: `EPI '${existing.identificacao}' excluído do almoxarifado.`,
      ip: getClientIp(req)
    });

    res.json({ success: true, message: 'Item removido do almoxarifado.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 5. ROTAS DE SOLICITAÇÕES E BAIXA AUTOMÁTICA DE EPI
// =========================================================================

app.get('/api/requests', async (req, res) => {
  try {
    const { empresaId } = req.query;
    let sql = `
      SELECT r.*, m.ca_number as ca_atual, m.quantidade_disponivel as estoque_atual_almoxarifado
      FROM epi_requests r
      LEFT JOIN inventory_materials m ON r.material_id = m.id
    `;
    let params = [];
    if (empresaId) {
      sql += ' WHERE r.empresa_id = ?';
      params.push(empresaId);
    }
    sql += ' ORDER BY r.data_solicitacao DESC';
    const requests = await dbAll(sql, params);
    res.json({ requests });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar solicitação de EPI (Aceita único item ou múltiplos itens em lote)
app.post('/api/requests', async (req, res) => {
  try {
    const { empresaId, colaborador, funcaoColaborador, cpfColaborador, materialId, quantidade, motivo, items, userId, username, latitude, longitude, locationText } = req.body;

    if (!empresaId || !colaborador || (!materialId && (!items || items.length === 0))) {
      return res.status(400).json({ error: 'Empresa, colaborador e pelo menos um item de EPI são obrigatórios.' });
    }

    const itemsToProcess = (items && Array.isArray(items) && items.length > 0)
      ? items
      : [{ materialId, quantidade: Number(quantidade) || 1, motivo: motivo || 'Substituição Periódica' }];

    const createdRequests = [];

    for (const item of itemsToProcess) {
      if (!item.materialId) continue;
      const material = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [item.materialId]);
      if (!material) continue;

      const reqId = uid('req');
      const qtdPedida = Number(item.quantidade) || 1;
      const itemMotivo = item.motivo || motivo || 'Substituição Periódica';

      await dbRun(`
        INSERT INTO epi_requests (id, empresa_id, colaborador, funcao_colaborador, cpf_colaborador, material_id, material_nome, ca_number, quantidade, motivo, status, data_solicitacao)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aberta', datetime('now', 'localtime'))
      `, [
        reqId,
        empresaId,
        colaborador.trim(),
        funcaoColaborador || 'Colaborador Operacional',
        cpfColaborador || '',
        material.id,
        material.identificacao,
        material.ca_number,
        qtdPedida,
        itemMotivo
      ]);

      const newRequest = await dbGet('SELECT * FROM epi_requests WHERE id = ?', [reqId]);
      createdRequests.push(newRequest);
    }

    if (createdRequests.length === 0) {
      return res.status(400).json({ error: 'Nenhum item válido de EPI foi selecionado no almoxarifado.' });
    }

    await logAudit({
      userId,
      username,
      action: 'EPI_REQUESTED',
      description: `Pedido de EPI (${createdRequests.length} item(ns)) gerado para '${colaborador.trim()}'.`,
      details: { colaborador, totalItens: createdRequests.length },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    res.status(201).json({
      success: true,
      request: createdRequests[0],
      requests: createdRequests,
      message: `${createdRequests.length} item(ns) de EPI registrado(s) com sucesso para '${colaborador}'.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// BAIXA AUTOMÁTICA NO ESTOQUE AO APROVAR / ENTREGAR O EPI
app.post('/api/requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianId, technicianName, technicianRegistration, observacoes, latitude, longitude, locationText } = req.body;

    const request = await dbGet('SELECT * FROM epi_requests WHERE id = ?', [id]);
    if (!request) {
      return res.status(404).json({ error: 'Solicitação não encontrada.' });
    }

    if (request.status === 'aprovada') {
      return res.status(400).json({ error: 'Esta solicitação já foi aprovada e a baixa já foi realizada anteriormente.' });
    }

    const material = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [request.material_id]);
    if (!material) {
      return res.status(404).json({ error: 'Material vinculado não encontrado no almoxarifado.' });
    }

    const qtdDeducao = Number(request.quantidade) || 1;

    // Validação de saldo em estoque
    if (material.quantidade_disponivel < qtdDeducao) {
      return res.status(400).json({
        error: `Estoque insuficiente! O almoxarifado possui apenas ${material.quantidade_disponivel} ${material.unidade} de '${material.identificacao}', mas a solicitação requer ${qtdDeducao} ${material.unidade}. Reabasteça o estoque antes de autorizar a entrega.`
      });
    }

    // 1. DÉBITO AUTOMÁTICO DO ESTOQUE
    const novoEstoque = material.quantidade_disponivel - qtdDeducao;
    await dbRun(`
      UPDATE inventory_materials 
      SET quantidade_disponivel = ?
      WHERE id = ?
    `, [novoEstoque, material.id]);

    // 2. ATUALIZAR STATUS DA SOLICITAÇÃO COM DADOS DO TÉCNICO RESPONSÁVEL
    await dbRun(`
      UPDATE epi_requests 
      SET status = 'aprovada',
          aprovado_por_id = ?,
          aprovado_por_nome = ?,
          aprovado_por_registro = ?,
          data_aprovacao = datetime('now', 'localtime'),
          observacoes_aprovacao = ?,
          termo_assinado = 1
      WHERE id = ?
    `, [
      technicianId || 'tech_admin',
      technicianName || 'Técnico Responsável SST',
      technicianRegistration || 'MTE-SST-004521/SP',
      observacoes || 'Entrega autorizada e conferida pelo técnico responsável. EPI em perfeito estado com CA válido.',
      id
    ]);

    // 3. REGISTRAR NO LOG DE AUDITORIA COM TIMESTAMP, GEOLOCALIZAÇÃO E TÉCNICO
    await logAudit({
      userId: technicianId || 'tech_admin',
      username: technicianName || 'Técnico SST',
      action: 'EPI_DELIVERY_APPROVED',
      description: `[BAIXA DE ESTOQUE AUTOMÁTICA] Entrega aprovada pelo Técnico '${technicianName || 'Admin'}': ${qtdDeducao}x '${material.identificacao}' para '${request.colaborador}'. Saldo no almoxarifado atualizado: ${novoEstoque} ${material.unidade}.`,
      details: {
        requestId: id,
        colaborador: request.colaborador,
        funcao: request.funcao_colaborador,
        materialId: material.id,
        materialNome: material.identificacao,
        caNumber: material.ca_number,
        quantidadeEntregue: qtdDeducao,
        estoqueAnterior: material.quantidade_disponivel,
        estoqueRestante: novoEstoque,
        tecnicoResponsavel: technicianName,
        registroTecnico: technicianRegistration
      },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText: locationText || 'Terminal Operacional SST'
    });

    const updatedRequest = await dbGet(`
      SELECT r.*, c.name as empresa_nome
      FROM epi_requests r
      LEFT JOIN companies c ON r.empresa_id = c.id
      WHERE r.id = ?
    `, [id]);
    const updatedMaterial = await dbGet('SELECT * FROM inventory_materials WHERE id = ?', [material.id]);

    res.json({
      success: true,
      message: `EPI aprovado com sucesso! Baixa automática de ${qtdDeducao} ${material.unidade} realizada no almoxarifado. Novo saldo: ${novoEstoque} ${material.unidade}.`,
      request: updatedRequest,
      material: updatedMaterial
    });
  } catch (err) {
    console.error('[ApproveEPI] Erro:', err);
    res.status(500).json({ error: 'Erro ao processar baixa de EPI: ' + err.message });
  }
});

// Rejeitar / Cancelar solicitação
app.post('/api/requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { technicianId, technicianName, motivo, latitude, longitude, locationText } = req.body;

    const request = await dbGet('SELECT * FROM epi_requests WHERE id = ?', [id]);
    if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    await dbRun(`
      UPDATE epi_requests 
      SET status = 'rejeitada',
          observacoes_aprovacao = ?,
          data_aprovacao = datetime('now', 'localtime')
      WHERE id = ?
    `, [motivo || 'Solicitação recusada pelo técnico responsável.', id]);

    await logAudit({
      userId: technicianId,
      username: technicianName,
      action: 'EPI_REQUEST_REJECTED',
      description: `Solicitação de EPI para '${request.colaborador}' recusada: ${motivo || 'Sem justificativa especificada'}.`,
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    const updated = await dbGet('SELECT * FROM epi_requests WHERE id = ?', [id]);
    res.json({ request: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 6. ROTAS DE ANÁLISE DE RISCO / RECONHECIMENTO COM FOTO
// =========================================================================

app.get('/api/risks', async (req, res) => {
  try {
    const { empresaId } = req.query;
    let sql = 'SELECT * FROM risk_analyses';
    let params = [];
    if (empresaId) {
      sql += ' WHERE empresa_id = ?';
      params.push(empresaId);
    }
    sql += ' ORDER BY created_at DESC';
    const analyses = await dbAll(sql, params);
    res.json({ analyses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/risks', async (req, res) => {
  try {
    const { empresaId, local, setor, tipoRisco, nivelRisco, riscos, medidasPreventivas, items, foto, registradoPor, userId, username, latitude, longitude, locationText } = req.body;

    if (!empresaId || !local) {
      return res.status(400).json({ error: 'Empresa e Local inspecionado são obrigatórios.' });
    }

    const itemsToProcess = (items && Array.isArray(items) && items.length > 0)
      ? items
      : [{ tipoRisco: tipoRisco || 'Físico', nivelRisco: nivelRisco || 'Médio', riscos: riscos || '', medidasPreventivas: medidasPreventivas || '' }];

    const validItems = itemsToProcess.filter(it => it.riscos && it.riscos.trim());
    if (validItems.length === 0) {
      return res.status(400).json({ error: 'Informe a descrição de pelo menos um risco identificado.' });
    }

    const dataStr = new Date().toLocaleDateString('pt-BR');
    const createdAnalyses = [];

    for (const item of validItems) {
      const riskId = uid('risk');
      await dbRun(`
        INSERT INTO risk_analyses (id, empresa_id, local, setor, tipo_risco, nivel_risco, riscos, medidas_preventivas, foto, registrado_por, data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        riskId,
        empresaId,
        local.trim(),
        setor || 'Geral',
        item.tipoRisco || 'Físico',
        item.nivelRisco || 'Médio',
        item.riscos.trim(),
        item.medidasPreventivas || '',
        foto || null,
        registradoPor || username || 'Técnico Responsável',
        dataStr
      ]);

      const newAnalysis = await dbGet('SELECT * FROM risk_analyses WHERE id = ?', [riskId]);
      createdAnalyses.push(newAnalysis);
    }

    await logAudit({
      userId,
      username,
      action: 'RISK_INSPECTION_CREATED',
      description: `Inspeção de Riscos registrada no local '${local.trim()}' com ${createdAnalyses.length} risco(s) individual(is) detalhado(s)${foto ? ' e foto anexada' : ''}.`,
      details: { totalRiscos: createdAnalyses.length, local, hasPhoto: !!foto },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });

    res.status(201).json({
      success: true,
      analysis: createdAnalyses[0],
      analyses: createdAnalyses,
      message: `${createdAnalyses.length} risco(s) registrado(s) com sucesso na inspeção de '${local}'.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/risks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, username } = req.body;
    const existing = await dbGet('SELECT * FROM risk_analyses WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Inspeção não encontrada.' });

    await dbRun('DELETE FROM risk_analyses WHERE id = ?', [id]);

    await logAudit({
      userId,
      username,
      action: 'RISK_INSPECTION_DELETED',
      description: `Relatório de Inspeção de Risco do local '${existing.local}' foi excluído.`,
      ip: getClientIp(req)
    });

    res.json({ success: true, message: 'Inspeção excluída com sucesso.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 7. ROTAS DE AUDITORIA E RASTREAMENTO EM TEMPO REAL
// =========================================================================

app.get('/api/audit', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 100;
    const logs = await dbAll(`
      SELECT * FROM audit_logs 
      ORDER BY timestamp DESC 
      LIMIT ?
    `, [limit]);
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/audit/event', async (req, res) => {
  try {
    const { userId, username, action, description, details, latitude, longitude, locationText } = req.body;
    await logAudit({
      userId,
      username,
      action: action || 'USER_ACTION',
      description: description || 'Ação do usuário',
      details,
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 8. ROTAS DE PAGAMENTO E ASSINATURA PRO (PIX, CRÉDITO, DÉBITO, BOLETO)
// =========================================================================

// Obter dados e QR Code real do PIX
app.get('/api/pix/data', async (req, res) => {
  try {
    let config = await dbGet('SELECT * FROM pix_settings WHERE id = ?', ['global_pix']);
    if (!config) {
      config = {
        pix_key: 'contato@sstpro.com.br',
        key_type: 'email',
        merchant_name: 'SST PRO SISTEMAS',
        merchant_city: 'SAO PAULO',
        amount: 149.90,
        tx_id: 'SSTPRO149'
      };
    }

    const payloadResult = generatePixPayload({
      pixKey: config.pix_key,
      merchantName: config.merchant_name,
      merchantCity: config.merchant_city,
      amount: config.amount || 149.90,
      txId: config.tx_id || 'SSTPRO149'
    });

    const qrCodeDataUrl = await generatePixQRCodeDataURL(payloadResult.pixCode);

    res.json({
      success: true,
      config,
      pixCode: payloadResult.pixCode,
      qrCodeDataUrl,
      amount: payloadResult.amount,
      merchantName: payloadResult.merchantName,
      merchantCity: payloadResult.merchantCity,
      txId: payloadResult.txId,
      pixKey: payloadResult.pixKey
    });
  } catch (err) {
    console.error('[PixData] Erro:', err);
    res.status(500).json({ error: 'Erro ao gerar dados do PIX: ' + err.message });
  }
});

// Atualizar chave PIX e beneficiário no sistema
app.post('/api/pix/settings', async (req, res) => {
  try {
    const { pixKey, keyType, merchantName, merchantCity, amount, txId, userId, username } = req.body;

    if (!pixKey || !pixKey.trim()) {
      return res.status(400).json({ error: 'Chave PIX é obrigatória.' });
    }

    const cleanKey = pixKey.trim();
    const cleanType = keyType || 'email';
    const cleanName = (merchantName || 'SST PRO SISTEMAS').trim();
    const cleanCity = (merchantCity || 'SAO PAULO').trim();
    const cleanAmount = Number(amount) || 149.90;
    const cleanTxId = (txId || 'SSTPRO149').trim();

    await dbRun(`
      INSERT INTO pix_settings (id, pix_key, key_type, merchant_name, merchant_city, amount, tx_id, updated_at)
      VALUES ('global_pix', ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        pix_key = excluded.pix_key,
        key_type = excluded.key_type,
        merchant_name = excluded.merchant_name,
        merchant_city = excluded.merchant_city,
        amount = excluded.amount,
        tx_id = excluded.tx_id,
        updated_at = datetime('now', 'localtime')
    `, [cleanKey, cleanType, cleanName, cleanCity, cleanAmount, cleanTxId]);

    const payloadResult = generatePixPayload({
      pixKey: cleanKey,
      merchantName: cleanName,
      merchantCity: cleanCity,
      amount: cleanAmount,
      txId: cleanTxId
    });

    const qrCodeDataUrl = await generatePixQRCodeDataURL(payloadResult.pixCode);

    await logAudit({
      userId,
      username,
      action: 'PIX_SETTINGS_UPDATED',
      description: `Configuração da Chave PIX atualizada no sistema para '${cleanKey}' (${cleanName}).`,
      details: { pixKey: cleanKey, merchantName: cleanName, amount: cleanAmount },
      ip: getClientIp(req)
    });

    res.json({
      success: true,
      message: 'Chave PIX e QR Code atualizados com sucesso!',
      pixCode: payloadResult.pixCode,
      qrCodeDataUrl,
      config: {
        pix_key: cleanKey,
        key_type: cleanType,
        merchant_name: cleanName,
        merchant_city: cleanCity,
        amount: cleanAmount,
        tx_id: cleanTxId
      }
    });
  } catch (err) {
    console.error('[PixSettings] Erro:', err);
    res.status(500).json({ error: 'Erro ao atualizar chave PIX: ' + err.message });
  }
});

app.get('/api/payment/status', async (req, res) => {
  try {
    const { userId } = req.query;
    let sub = null;
    if (userId) {
      sub = await dbGet('SELECT * FROM subscriptions WHERE user_id = ?', [userId]);
    }
    if (!sub) {
      sub = await dbGet('SELECT * FROM subscriptions WHERE id = "sub_global" LIMIT 1');
    }
    res.json({
      isPremium: sub ? Boolean(sub.is_premium) : false,
      subscription: sub ? {
        planName: sub.plan_name,
        paymentMethod: sub.payment_method,
        amount: sub.amount,
        transactionId: sub.transaction_id,
        activatedAt: sub.activated_at,
        receipt: sub.receipt_json ? JSON.parse(sub.receipt_json) : null
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Processar pagamento e ativar PRO com comprovante
app.post('/api/payment/checkout', async (req, res) => {
  try {
    const { paymentMethod, paymentDetails, amount, userId, username, latitude, longitude, locationText } = req.body;

    const txId = uid('tx_sst');
    const valorPago = amount || 149.00;
    const dataHora = new Date().toISOString();

    const receipt = {
      transactionId: txId,
      status: 'CONFIRMADO_APROVADO',
      paymentMethod: paymentMethod || 'pix',
      amount: valorPago,
      currency: 'BRL',
      planName: 'SST PRO - Gestão Completa Desktop',
      beneficiary: 'SST PRO Sistemas de Segurança Ltda',
      cnpj: '48.910.112/0001-34',
      subscriber: username || 'Técnico Responsável',
      authCode: `AUTH-${Math.random().toString(36).substring(2, 10).toUpperCase()}-${Date.now()}`,
      issuedAt: new Date().toLocaleString('pt-BR'),
      details: paymentDetails || {}
    };

    const subId = userId ? `sub_${userId}` : 'sub_global';

    // Atualizar/inserir assinatura para o usuário específico no SQLite
    await dbRun(`
      INSERT INTO subscriptions (id, user_id, is_premium, plan_name, payment_method, amount, transaction_id, receipt_json, activated_at, updated_at)
      VALUES (?, ?, 1, 'SST PRO Desktop Anual/Mensal', ?, ?, ?, ?, ?, datetime('now', 'localtime'))
      ON CONFLICT(id) DO UPDATE SET
        is_premium = 1,
        plan_name = 'SST PRO Desktop Anual/Mensal',
        payment_method = excluded.payment_method,
        amount = excluded.amount,
        transaction_id = excluded.transaction_id,
        receipt_json = excluded.receipt_json,
        activated_at = excluded.activated_at,
        updated_at = datetime('now', 'localtime')
    `, [subId, userId || null, paymentMethod || 'pix', valorPago, txId, JSON.stringify(receipt), dataHora]);

    // Registrar no Log de Auditoria
    await logAudit({
      userId,
      username,
      action: 'PAYMENT_PRO_ACTIVATED',
      description: `Assinatura PRO Ativada com Sucesso via [${(paymentMethod || 'PIX').toUpperCase()}]. Todas as funcionalidades avançadas foram liberadas no banco de dados.`,
      details: { transactionId: txId, method: paymentMethod, amount: valorPago },
      ip: getClientIp(req),
      lat: latitude,
      lng: longitude,
      locationText: locationText || 'Checkout Online'
    });

    res.json({
      success: true,
      isPremium: true,
      message: 'Pagamento processado com sucesso! Acesso PRO liberado.',
      receipt
    });
  } catch (err) {
    console.error('[Payment/Checkout] Erro:', err);
    res.status(500).json({ error: 'Erro ao processar pagamento: ' + err.message });
  }
});

// Cancelar / Resetar plano PRO (para testes)
app.post('/api/payment/cancel', async (req, res) => {
  try {
    const { userId, username } = req.body;
    await dbRun(`
      UPDATE subscriptions 
      SET is_premium = 0,
          plan_name = 'Plano Gratuito',
          payment_method = NULL,
          amount = 0,
          receipt_json = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE id = 'sub_global'
    `);

    await logAudit({
      userId,
      username,
      action: 'PAYMENT_PRO_CANCELLED',
      description: `Assinatura PRO foi cancelada ou revertida para modo gratuito.`,
      ip: getClientIp(req)
    });

    res.json({ success: true, isPremium: false, message: 'Plano revertido para o modo gratuito.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rota de fallback para SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Iniciar servidor após banco de dados pronto
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 SST PRO Server Ativo & Operacional`);
      console.log(`🌐 Site Oficial: https://sstpro.com.br`);
      console.log(`📍 Acesso Local: http://localhost:${PORT}`);
      console.log(`💾 Banco de Dados: SQLite local (data/sst_pro.sqlite)`);
      console.log(`🔑 Login Inicial: admin | Senha: 1234`);
      console.log(`📦 Status Almoxarifado: Baixa Automática de EPI Ativa`);
      console.log(`=======================================================`);
    });
  } catch (err) {
    console.error('Falha crítica ao iniciar servidor:', err);
    process.exit(1);
  }
}

startServer();
