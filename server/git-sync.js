import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.join(__dirname, '..');

// Carregar variáveis de .env se presente
function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const envPath = path.join(REPO_ROOT, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/GITHUB_TOKEN=(.+)/);
      if (match) return match[1].trim();
    }
  } catch (e) {}
  return '';
}

function getRepoUrl() {
  const token = getGitHubToken();
  if (token) {
    return `https://Miranhada07:${token}@github.com/Miranhada07/sst-pro.git`;
  }
  return 'origin';
}

let isSyncing = false;

export function syncWithGithub(reason = 'Alterações automáticas e auditoria') {
  return new Promise((resolve) => {
    if (isSyncing) {
      return resolve({ success: false, message: 'Sincronização já em andamento.' });
    }

    isSyncing = true;
    const timestamp = new Date().toLocaleString('pt-BR');
    const commitMsg = `auto-sync: ${reason} [${timestamp}]`;

    // 1. Adicionar alterações 2. Criar commit se houver modificações 3. Push para o repositório oficial
    const targetRepo = getRepoUrl();
    const cmd = `git add . && (git diff-index --quiet HEAD || git commit -m "${commitMsg}") && git push ${targetRepo} main`;

    exec(cmd, { cwd: REPO_ROOT }, (error, stdout, stderr) => {
      isSyncing = false;
      if (error) {
        // Se já estiver atualizado ou sem modificações, considerar sucesso
        if (stdout.includes('nothing to commit') || stderr.includes('nothing to commit') || stdout.includes('Everything up-to-date') || stderr.includes('Everything up-to-date')) {
          console.log('[GitSync] ✅ Repositório sincronizado e atualizado.');
          return resolve({ success: true, message: 'Repositório atualizado.' });
        }
        console.warn('[GitSync] Aviso na sincronização automática:', error.message);
        return resolve({ success: false, error: error.message });
      }

      console.log(`[GitSync] 🚀 Sincronização automática com GitHub concluída com sucesso: ${commitMsg}`);
      resolve({ success: true, stdout });
    });
  });
}

// Iniciar agendamento automático de backup e push no GitHub a cada 15 minutos
export function startGitAutoSync() {
  console.log('[GitSync] 🔄 Serviço de sincronização automática com GitHub ativado.');
  
  // Executar uma sincronização inicial após 30 segundos de boot
  setTimeout(() => {
    syncWithGithub('Inicialização do servidor SST PRO');
  }, 30000);

  // Sincronização periódica a cada 15 minutos
  setInterval(() => {
    syncWithGithub('Sincronização periódica de banco de dados e logs');
  }, 15 * 60 * 1000);
}
