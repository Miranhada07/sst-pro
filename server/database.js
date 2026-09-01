import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'sst_pro.sqlite');
console.log(`[Database] Inicializando banco de dados local SQLite em: ${DB_PATH}`);

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[Database] Erro ao conectar ao SQLite:', err.message);
  } else {
    console.log('[Database] Conectado com sucesso ao SQLite local.');
  }
});

// Helper de Promises para SQLite
export const dbRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

export const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

export const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

// Backup de segurança automático do banco SQLite
export async function backupDatabase() {
  try {
    const BACKUP_DIR = path.join(DATA_DIR, 'backups');
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    if (!fs.existsSync(DB_PATH)) return;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const backupFile = path.join(BACKUP_DIR, `sst_pro_backup_${timestamp}.sqlite`);

    fs.copyFileSync(DB_PATH, backupFile);
    console.log(`[Database/Backup] ✅ Backup de segurança criado com sucesso: ${path.basename(backupFile)}`);

    // Manter os últimos 20 backups e rotacionar os mais antigos
    const files = fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('sst_pro_backup_') && f.endsWith('.sqlite')).sort();
    if (files.length > 20) {
      const toDelete = files.slice(0, files.length - 20);
      for (const f of toDelete) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { }
      }
    }
  } catch (err) {
    console.error('[Database/Backup] Erro ao criar backup automático:', err.message);
  }
}

// Inicialização e Criação das Tabelas
export async function initDatabase() {
  // Habilitar foreign keys e WAL mode para alta performance e concorrência local
  await dbRun('PRAGMA foreign_keys = ON');
  await dbRun('PRAGMA journal_mode = WAL');

  // Criar backup automático na inicialização
  await backupDatabase();

  // Agendar backup periódico a cada 1 hora de funcionamento
  setInterval(backupDatabase, 1000 * 60 * 60);

  // 1. Tabela de Usuários / Técnicos Responsáveis com Módulos Permitidos (RBAC)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'technician',
      allowed_modules TEXT DEFAULT 'riscos',
      registration_number TEXT,
      email TEXT,
      phone TEXT,
      avatar TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration de compatibilidade para garantir coluna allowed_modules
  try {
    await dbRun('ALTER TABLE users ADD COLUMN allowed_modules TEXT');
  } catch (e) {
    // Coluna já existe
  }

  // 2. Tabela de Empresas Gerenciadas (Isoladas por Usuário)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      cnpj TEXT,
      porte TEXT NOT NULL DEFAULT 'pequeno',
      valor_mensalidade REAL NOT NULL DEFAULT 2500,
      endereco TEXT,
      responsavel TEXT,
      email_contato TEXT,
      telefone_contato TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Migration de compatibilidade para garantir coluna user_id
  try {
    await dbRun('ALTER TABLE companies ADD COLUMN user_id TEXT');
  } catch (e) {
    // Coluna já existe
  }

  // 3. Tabela de Estoque de EPIs / Almoxarifado
  await dbRun(`
    CREATE TABLE IF NOT EXISTS inventory_materials (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      identificacao TEXT NOT NULL,
      ca_number TEXT,
      categoria TEXT DEFAULT 'Geral',
      quantidade_disponivel INTEGER NOT NULL DEFAULT 0,
      estoque_minimo INTEGER NOT NULL DEFAULT 5,
      unidade TEXT NOT NULL DEFAULT 'un',
      fornecedor TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (empresa_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  // 4. Tabela de Solicitações e Baixas de EPI
  await dbRun(`
    CREATE TABLE IF NOT EXISTS epi_requests (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      colaborador TEXT NOT NULL,
      funcao_colaborador TEXT,
      cpf_colaborador TEXT,
      material_id TEXT NOT NULL,
      material_nome TEXT NOT NULL,
      ca_number TEXT,
      quantidade INTEGER NOT NULL DEFAULT 1,
      motivo TEXT DEFAULT 'Substituição Periódica',
      status TEXT NOT NULL DEFAULT 'aberta',
      data_solicitacao DATETIME DEFAULT CURRENT_TIMESTAMP,
      aprovado_por_id TEXT,
      aprovado_por_nome TEXT,
      aprovado_por_registro TEXT,
      data_aprovacao DATETIME,
      observacoes_aprovacao TEXT,
      termo_assinado INTEGER DEFAULT 0,
      FOREIGN KEY (empresa_id) REFERENCES companies(id) ON DELETE CASCADE,
      FOREIGN KEY (material_id) REFERENCES inventory_materials(id) ON DELETE CASCADE
    )
  `);

  // 5. Tabela de Análise e Reconhecimento de Riscos
  await dbRun(`
    CREATE TABLE IF NOT EXISTS risk_analyses (
      id TEXT PRIMARY KEY,
      empresa_id TEXT NOT NULL,
      local TEXT NOT NULL,
      setor TEXT,
      tipo_risco TEXT DEFAULT 'Físico',
      nivel_risco TEXT DEFAULT 'Médio',
      riscos TEXT NOT NULL,
      medidas_preventivas TEXT,
      foto TEXT,
      registrado_por TEXT,
      data TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (empresa_id) REFERENCES companies(id) ON DELETE CASCADE
    )
  `);

  // 6. Tabela de Logs de Auditoria e Rastreamento em Tempo Real
  await dbRun(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
      details_json TEXT,
      ip_address TEXT,
      latitude REAL,
      longitude REAL,
      location_text TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 7. Tabela de Assinatura e Pagamentos (Por Usuário)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      is_premium INTEGER NOT NULL DEFAULT 0,
      plan_name TEXT DEFAULT 'Plano Gratuito',
      payment_method TEXT,
      amount REAL DEFAULT 0,
      transaction_id TEXT,
      receipt_json TEXT,
      activated_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  try {
    await dbRun('ALTER TABLE subscriptions ADD COLUMN user_id TEXT');
  } catch (e) {
    // Coluna já existe
  }

  // 8. Tabela de Sessão do Usuário (Onde parou na máquina)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id TEXT PRIMARY KEY,
      current_tab TEXT DEFAULT 'empresas',
      current_company_id TEXT,
      draft_state_json TEXT,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // 9. Tabela de Configurações do PIX (Chave real, Beneficiário, etc.)
  await dbRun(`
    CREATE TABLE IF NOT EXISTS pix_settings (
      id TEXT PRIMARY KEY,
      pix_key TEXT NOT NULL,
      key_type TEXT NOT NULL DEFAULT 'email',
      merchant_name TEXT NOT NULL DEFAULT 'SST PRO SISTEMAS',
      merchant_city TEXT NOT NULL DEFAULT 'SAO PAULO',
      amount REAL DEFAULT 149.90,
      tx_id TEXT DEFAULT 'SSTPRO149',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Inicializar Chave PIX Padrão se não existir
  const pixConfig = await dbGet('SELECT * FROM pix_settings WHERE id = ?', ['global_pix']);
  if (!pixConfig) {
    await dbRun(`
      INSERT INTO pix_settings (id, pix_key, key_type, merchant_name, merchant_city, amount, tx_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      'global_pix',
      'contato@sstpro.com.br',
      'email',
      'SST PRO SISTEMAS',
      'SAO PAULO',
      149.90,
      'SSTPRO149'
    ]);
  }

  // Inicializar Assinatura Padrão se não existir
  const sub = await dbGet('SELECT * FROM subscriptions LIMIT 1');
  if (!sub) {
    await dbRun(`
      INSERT INTO subscriptions (id, is_premium, plan_name, amount, activated_at)
      VALUES (?, ?, ?, ?, ?)
    `, ['sub_global', 0, 'Plano Gratuito', 0, new Date().toISOString()]);
  }

  // Inicializar Usuários Padrão com Permissões Específicas
  const defaultUsers = [
    {
      id: 'usr_admin_default',
      username: 'admin',
      password: '1234',
      name: 'Técnico Responsável SST Principal (Admin)',
      role: 'admin',
      allowedModules: 'empresas,riscos,almoxarifado,solicitacoes,auditoria,usuarios',
      reg: 'MTE-SST-004521/SP',
      email: 'admin@sstpro.com.br',
      phone: '(11) 98765-4321'
    },
    {
      id: 'usr_victor',
      username: 'Victor',
      password: '1234',
      name: 'Victor - Gestão de Riscos & Empresas',
      role: 'technician',
      allowedModules: 'empresas,riscos,solicitacoes,auditoria',
      reg: 'MTE-SST-004524/SP',
      email: 'victor@sstpro.com.br',
      phone: '(11) 98765-4324'
    },
    {
      id: 'usr_eric',
      username: 'Eric',
      password: '1234',
      name: 'Eric - Almoxarifado & Baixas de EPI',
      role: 'technician',
      allowedModules: 'almoxarifado,solicitacoes,auditoria',
      reg: 'MTE-SST-004522/SP',
      email: 'eric@sstpro.com.br',
      phone: '(11) 98765-4322'
    },
    {
      id: 'usr_samuel',
      username: 'Samuel',
      password: '1234',
      name: 'Samuel - Inspeções & Análise de Riscos',
      role: 'technician',
      allowedModules: 'riscos',
      reg: 'MTE-SST-004523/SP',
      email: 'samuel@sstpro.com.br',
      phone: '(11) 98765-4323'
    }
  ];

  for (const u of defaultUsers) {
    const existing = await dbGet('SELECT * FROM users WHERE username = ? COLLATE BINARY', [u.username]);
    if (!existing) {
      await dbRun(`
        INSERT INTO users (id, username, password, name, role, allowed_modules, registration_number, email, phone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [u.id, u.username, u.password, u.name, u.role, u.allowedModules, u.reg, u.email, u.phone]);
      console.log(`[Database] Usuário criado: ${u.username} (Módulos: ${u.allowedModules})`);
    } else {
      // Atualizar módulos e papéis definidos
      await dbRun(`
        UPDATE users 
        SET allowed_modules = ?, role = ?, name = ?
        WHERE username = ? COLLATE BINARY
      `, [u.allowedModules, u.role, u.name, u.username]);
    }
  }

  console.log('[Database] Todas as tabelas, permissões e índices verificados e prontos.');
}

export default db;
