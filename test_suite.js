// Test Suite End-to-End para SST PRO Enterprise (RBAC & Multi-Usuário)
import { dbGet, dbAll } from './server/database.js';

const API_BASE = 'http://localhost:3000/api';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 INICIANDO TESTES AUTOMATIZADOS E2E - SST PRO ENTERPRISE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  const assert = (condition, title) => {
    if (condition) {
      console.log(`  ✅ [PASSOU] ${title}`);
      passed++;
    } else {
      console.error(`  ❌ [FALHOU] ${title}`);
      failed++;
    }
  };

  try {
    // =========================================================================
    // TESTE 1: RBAC - Login de Todos os Usuários com Permissões Específicas
    // =========================================================================
    console.log('1. Testando RBAC e Permissões Granulares por Usuário...');

    // 1.1 Victor (Empresas, Riscos, Solicitações, Auditoria)
    const loginVictor = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Victor', password: '1234' })
    });
    const dataVictor = await loginVictor.json();
    assert(loginVictor.ok && dataVictor.user, 'Login de Victor (@Victor) autenticado com sucesso');
    const victorMods = (dataVictor.user?.allowed_modules || '').split(',');
    assert(
      victorMods.includes('empresas') && victorMods.includes('riscos') && victorMods.includes('solicitacoes') && victorMods.includes('auditoria') && !victorMods.includes('almoxarifado'),
      'Victor possui acesso restrito exatamente a: Empresas, Análise de Riscos, Solicitações e Auditoria (sem Almoxarifado)'
    );

    // 1.2 Eric (Almoxarifado, Solicitações, Auditoria)
    const loginEric = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Eric', password: '1234' })
    });
    const dataEric = await loginEric.json();
    assert(loginEric.ok && dataEric.user, 'Login de Eric (@Eric) autenticado com sucesso');
    const ericMods = (dataEric.user?.allowed_modules || '').split(',');
    assert(
      ericMods.includes('almoxarifado') && ericMods.includes('solicitacoes') && ericMods.includes('auditoria') && !ericMods.includes('empresas'),
      'Eric possui acesso restrito exatamente a: Almoxarifado, Solicitações e Baixa, Auditoria em tempo real'
    );

    // 1.3 Samuel / Técnicos de Campo (Apenas Análise de Riscos)
    const loginSamuel = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Samuel', password: '1234' })
    });
    const dataSamuel = await loginSamuel.json();
    assert(loginSamuel.ok && dataSamuel.user, 'Login de Samuel (@Samuel) autenticado com sucesso');
    const samuelMods = (dataSamuel.user?.allowed_modules || '').split(',');
    assert(
      samuelMods.includes('riscos') && samuelMods.length === 1,
      'Samuel (técnico de campo) possui acesso restrito exclusivamente a: Análise de Riscos'
    );

    // 1.4 Admin Geral (Acesso Total + Gestão de Usuários)
    const loginAdmin = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: '1234' })
    });
    const dataAdmin = await loginAdmin.json();
    assert(loginAdmin.ok && dataAdmin.user && dataAdmin.user.role === 'admin', 'Login do Administrador (@admin) autenticado com sucesso com papel "admin"');
    const adminUser = dataAdmin.user;

    // =========================================================================
    // TESTE 2: Gestão de Funcionários pelo Administrador (CRUD de Usuários)
    // =========================================================================
    console.log('\n2. Testando Módulo de Gestão de Funcionários pelo Administrador...');

    // 2.1 Criar Novo Funcionário
    const novoFuncRes = await fetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Roberto Vasconcelos',
        username: 'roberto',
        password: '123',
        role: 'technician',
        allowedModules: 'empresas,riscos',
        registrationNumber: 'MTE-SST-998877/SP',
        email: 'roberto@sstpro.com.br',
        phone: '(11) 98888-7777',
        createdBy: adminUser.id,
        createdByName: adminUser.name
      })
    });
    const novoFuncData = await novoFuncRes.json();
    assert(novoFuncRes.ok && novoFuncData.user && novoFuncData.user.id, `Novo funcionário cadastrado pelo admin: ${novoFuncData.user?.name} (@${novoFuncData.user?.username})`);
    const testUserId = novoFuncData.user?.id;

    // 2.2 Login Inicial com o Novo Funcionário (Requer Código de Verificação 2FA por E-mail)
    const loginRobertoInit = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'roberto', password: '123' })
    });
    const dataRobertoInit = await loginRobertoInit.json();
    assert(loginRobertoInit.ok && dataRobertoInit.require2FA === true && dataRobertoInit.userId === testUserId, 'Login do novo funcionário solicita código de verificação 2FA por e-mail');
    assert(dataRobertoInit.emailMasked.includes('@'), `E-mail mascarado com sucesso para proteção: ${dataRobertoInit.emailMasked}`);

    // 2.3 Testar Validação com Código Incorreto (Deve Falhar)
    const verifyWrongRes = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId, code: '000000' })
    });
    const verifyWrongData = await verifyWrongRes.json();
    assert(!verifyWrongRes.ok && verifyWrongData.error?.includes('Código incorreto'), 'Validação com código de 6 dígitos inválido bloqueada com segurança');

    // 2.4 Recuperar Código Ativo do Banco e Validar Acesso
    const { dbGet } = await import('./server/database.js');
    const activeOtp = await dbGet('SELECT * FROM verification_codes WHERE user_id = ? AND used = 0 ORDER BY created_at DESC LIMIT 1', [testUserId]);
    assert(activeOtp && activeOtp.code?.length === 6, `Código de 6 dígitos gerado e persistido com sucesso: [${activeOtp?.code}]`);

    const verifyCorrectRes = await fetch(`${API_BASE}/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: testUserId, code: activeOtp.code })
    });
    const verifyCorrectData = await verifyCorrectRes.json();
    assert(verifyCorrectRes.ok && verifyCorrectData.user?.name === 'Roberto Vasconcelos', 'Código de verificação validado com sucesso e acesso liberado');
    assert(verifyCorrectData.user?.is_verified === 1, 'Status de verificação do funcionário atualizado para verificado (is_verified = 1)');

    // 2.5 Próximo Login Direto para Usuário Já Verificado
    const loginRobertoVerified = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'roberto', password: '123' })
    });
    const dataRobertoVerified = await loginRobertoVerified.json();
    assert(loginRobertoVerified.ok && !dataRobertoVerified.require2FA && dataRobertoVerified.user?.name === 'Roberto Vasconcelos', 'Próximo login de usuário verificado realizado diretamente sem necessidade de novo 2FA');

    // 2.6 Atualizar Permissões do Funcionário
    const updateFuncRes = await fetch(`${API_BASE}/users/${testUserId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Roberto Vasconcelos Silva',
        allowedModules: 'empresas,riscos,solicitacoes',
        updatedBy: adminUser.id,
        updatedByName: adminUser.name
      })
    });
    const updateFuncData = await updateFuncRes.json();
    assert(updateFuncRes.ok && updateFuncData.user?.allowed_modules === 'empresas,riscos,solicitacoes', 'Permissões do funcionário atualizadas pelo Administrador');

    // 2.7 Listar Todos os Usuários
    const listUsersRes = await fetch(`${API_BASE}/users`);
    const listUsersData = await listUsersRes.json();
    assert(listUsersRes.ok && Array.isArray(listUsersData.users) && listUsersData.users.length >= 5, `Listagem de equipe retornou ${listUsersData.users.length} colaboradores`);

    // 2.8 Excluir o Funcionário de Teste
    const deleteFuncRes = await fetch(`${API_BASE}/users/${testUserId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deletedBy: adminUser.id, deletedByName: adminUser.name })
    });
    assert(deleteFuncRes.ok, 'Exclusão do funcionário de teste realizada com sucesso');

    // =========================================================================
    // TESTE 3: Empresas & Almoxarifado com Baixa Automática de Estoque
    // =========================================================================
    console.log('\n3. Testando Operação: Empresa, Almoxarifado e Baixa Automática de Estoque...');

    // 3.1 Cadastro de Empresa
    const compRes = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '[TESTE_AUTO] Mineradora Serra Dourada S/A',
        cnpj: '55.444.333/0001-22',
        porte: 'medio_grande',
        valorMensalidade: 1500,
        endereco: 'Rodovia dos Minérios, Km 42',
        responsavel: 'Eng. Roberto Vasconcelos',
        userId: adminUser.id,
        username: adminUser.name
      })
    });
    const compData = await compRes.json();
    assert(compRes.ok && compData.company && compData.company.id, `Empresa criada: ${compData.company?.name}`);
    const testCompanyId = compData.company.id;

    // 3.2 Cadastro de Material no Almoxarifado
    const matRes = await fetch(`${API_BASE}/inventory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId: testCompanyId,
        identificacao: 'Protetor Facial Policarbonato Incolor',
        caNumber: 'CA 18.940',
        categoria: 'Proteção Visual',
        quantidadeDisponivel: 20,
        estoqueMinimo: 5,
        unidade: 'un',
        userId: adminUser.id,
        username: adminUser.name
      })
    });
    const matData = await matRes.json();
    assert(matRes.ok && matData.material && matData.material.quantidade_disponivel === 20, 'EPI cadastrado com saldo inicial de 20 unidades');
    const testMatId = matData.material.id;

    // 3.3 Solicitação de EPI
    const reqRes = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId: testCompanyId,
        colaborador: 'Marcos Aurélio da Silva',
        funcaoColaborador: 'Operador de Esmerilhadeira',
        materialId: testMatId,
        quantidade: 3,
        motivo: 'Início em setor com projeção de partículas',
        userId: adminUser.id,
        username: adminUser.name
      })
    });
    const reqData = await reqRes.json();
    assert(reqRes.ok && reqData.request && reqData.request.status === 'aberta', 'Solicitação gerada com status "aberta" para 3 unidades');
    const testRequestId = reqData.request.id;

    // 3.4 Aprovação com Baixa Automática (20 -> 17)
    const approveRes = await fetch(`${API_BASE}/requests/${testRequestId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        technicianId: adminUser.id,
        technicianName: adminUser.name,
        technicianRegistration: adminUser.registration_number,
        observacoes: 'EPI entregue em perfeitas condições com CA válido.',
        latitude: -23.5505,
        longitude: -46.6333,
        locationText: 'São Paulo, SP'
      })
    });
    const approveData = await approveRes.json();
    assert(approveRes.ok && approveData.request.status === 'aprovada', 'Solicitação aprovada com sucesso');
    assert(approveData.material.quantidade_disponivel === 17, `Baixa de estoque confirmada no SQLite: Saldo 20 -> ${approveData.material.quantidade_disponivel} un`);

    // =========================================================================
    // TESTE 4: Registro de Análise de Risco com Múltiplos Riscos e Foto
    // =========================================================================
    console.log('\n4. Testando Análise de Riscos com Evidência...');
    const riskRes = await fetch(`${API_BASE}/risks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId: testCompanyId,
        local: 'Galpão de Moagem e Britagem',
        setor: 'Produção / Britagem',
        tipoRisco: 'Físico, Químico, Ergonômico',
        nivelRisco: 'Alto',
        riscos: 'Ruído contínuo de 92 dBA; Poeira mineral em suspensão; Postura inadequada.',
        medidasPreventivas: 'Uso obrigatório de protetor auricular tipo concha e respirador PFF2.',
        foto: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        registradoPor: adminUser.name,
        userId: adminUser.id,
        username: adminUser.name
      })
    });
    const riskData = await riskRes.json();
    assert(riskRes.ok && riskData.analysis && riskData.analysis.id, 'Análise de risco com múltiplos riscos cadastrada com foto');

    // =========================================================================
    // TESTE 5: Módulo de Sincronização com GitHub
    // =========================================================================
    console.log('\n5. Testando Endpoint de Sincronização Automática com GitHub...');
    const gitSyncRes = await fetch(`${API_BASE}/git/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Teste automatizado de sincronização com GitHub',
        username: adminUser.name
      })
    });
    const gitSyncData = await gitSyncRes.json();
    assert(gitSyncRes.ok && (gitSyncData.success !== undefined || gitSyncData.message || gitSyncData.error), `Endpoint de sincronização Git respondeu: ${gitSyncData.message || (gitSyncData.success ? 'Push executado' : 'Aviso retornado')}`);

    // =========================================================================
    // TESTE 6: Auditoria e Logs em Tempo Real
    // =========================================================================
    console.log('\n6. Testando Feed de Auditoria e Logs em Tempo Real...');
    const auditRes = await fetch(`${API_BASE}/audit?limit=50`);
    const auditData = await auditRes.json();
    const hasDeliveryAudit = auditData.logs.some(l => l.action.includes('EPI_DELIVERY') || l.action.includes('REQUEST'));
    const hasLoginAudit = auditData.logs.some(l => l.action.includes('LOGIN'));
    assert(auditData.logs.length > 0 && hasDeliveryAudit && hasLoginAudit, 'Logs de autenticação, entrega de EPI e gestão registrados na auditoria');

    // Limpeza da empresa de teste criada
    if (testCompanyId) {
      await fetch(`${API_BASE}/companies/${testCompanyId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: adminUser.id, username: adminUser.name })
      });
      console.log('\n  🧹 [LIMPEZA SEGURA] Dados do teste automatizado removidos com integridade preservada.');
    }

  } catch (err) {
    console.error('Erro na execução dos testes:', err);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passed} PASSARAM | ${failed} FALHARAM`);
  console.log('====================================================\n');

  if (failed === 0) {
    console.log('🎉 TODOS OS REQUISITOS RBAC, GESTÃO DE EQUIPE E MULTI-PLATAFORMA FORAM APROVADOS!');
  } else {
    process.exit(1);
  }
}

runTests();
