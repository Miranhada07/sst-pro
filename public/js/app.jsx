const { useState, useEffect, useRef, useMemo } = React;

// Utilitários de Formatação e Helpers
const formatCurrency = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleString('pt-BR');
};

const Icon = ({ name, color, style, className = "" }) => (
  <span className={`material-symbols-outlined ${className}`} style={{ color: color || 'inherit', fontSize: style?.fontSize || '20px', ...style }}>
    {name}
  </span>
);

// Máscara e Validação Automática de CNPJ (00.000.000/0001-00)
const maskCNPJ = (val) => {
  if (!val) return '';
  const d = val.replace(/\D/g, '').slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
};

const validateCNPJ = (cnpjStr) => {
  if (!cnpjStr) return true;
  const clean = cnpjStr.replace(/\D/g, '');
  if (clean.length === 0) return true;
  if (clean.length !== 14) return false;
  if (/^(\d)\1+$/.test(clean)) return false; // Rejeita sequências repetidas (00000000000000, 11111111111111)

  let tamanho = clean.length - 2;
  let numeros = clean.substring(0, tamanho);
  let digitos = clean.substring(tamanho);
  let soma = 0;
  let pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += Number(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== Number(digitos.charAt(0))) return false;

  tamanho = tamanho + 1;
  numeros = clean.substring(0, tamanho);
  soma = 0;
  pos = tamanho - 7;
  for (let i = tamanho; i >= 1; i--) {
    soma += Number(numeros.charAt(tamanho - i)) * pos--;
    if (pos < 2) pos = 9;
  }
  resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
  if (resultado !== Number(digitos.charAt(1))) return false;

  return true;
};

// Toast Notification Manager
let showToastGlobal = null;

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          <Icon name={t.type === 'success' ? 'check_circle' : t.type === 'error' ? 'error' : 'info'} style={{ color: '#fff' }} />
          <div style={{ flex: 1 }}>{t.message}</div>
          <button onClick={() => removeToast(t.id)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>
            <Icon name="close" style={{ fontSize: '16px' }} />
          </button>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// COMPONENTE PRINCIPAL (App)
// =========================================================================
function App() {
  // Estado de Autenticação
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  // Estado Geral da Aplicação
  const [isPremium, setIsPremium] = useState(false);
  const [subscriptionInfo, setSubscriptionInfo] = useState(null);
  const [tab, setTab] = useState("empresas");
  const [empresaAtivaId, setEmpresaAtivaId] = useState(null);

  // Dados do Banco de Dados
  const [empresas, setEmpresas] = useState([]);
  const [materiais, setMateriais] = useState([]);
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [analisesRiscos, setAnalisesRiscos] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);

  // Geolocalização em Tempo Real
  const [geoCoords, setGeoCoords] = useState({ lat: null, lng: null, text: 'Detectando localização...', accuracy: null });

  // Toasts
  const [toasts, setToasts] = useState([]);

  // Modais
  const [termoModalData, setTermoModalData] = useState(null);
  const [reciboPagamentoData, setReciboPagamentoData] = useState(null);
  const [perfilModalOpen, setPerfilModalOpen] = useState(false);

  const showToast = (message, type = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4500);
  };
  showToastGlobal = showToast;

  // 1. Capturar Geolocalização em Tempo Real
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          setGeoCoords({
            lat: latitude,
            lng: longitude,
            accuracy: Math.round(accuracy),
            text: `${latitude.toFixed(4)}, ${longitude.toFixed(4)} (Precisão: ~${Math.round(accuracy)}m)`
          });
        },
        (err) => {
          console.warn('[Geo] Acesso à geolocalização negado ou indisponível:', err.message);
          setGeoCoords({ lat: -23.5505, lng: -46.6333, text: 'Terminal Local (São Paulo, SP)', accuracy: 50 });
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      setGeoCoords({ lat: null, lng: null, text: 'Localhost (Sem GPS nativo)', accuracy: null });
    }
  }, []);

  // 2. Verificar Sessão no Carregamento Inicial (Prioriza aba atual independente)
  useEffect(() => {
    async function checkInitialSession() {
      try {
        const storedUser = sessionStorage.getItem('sst_pro_user') || localStorage.getItem('sst_pro_user');
        if (storedUser) {
          const userObj = JSON.parse(storedUser);
          setCurrentUser(userObj);

          // Buscar onde este usuário específico parou no banco SQLite
          const resSession = await fetch(`/api/session/${userObj.id}`);
          const dataSession = await resSession.json();

          if (dataSession.session) {
            if (dataSession.session.currentTab) setTab(dataSession.session.currentTab);
            if (dataSession.session.currentCompanyId) setEmpresaAtivaId(dataSession.session.currentCompanyId);
          }
        }
      } catch (err) {
        console.error('Erro ao verificar sessão salva:', err);
      } finally {
        setIsLoadingAuth(false);
      }
    }
    checkInitialSession();
  }, []);

  // 3. Carregar dados gerais quando logado (Isolados por usuário)
  useEffect(() => {
    if (!currentUser) return;
    loadAllData();
  }, [currentUser]);

  // Carregar todos os dados do banco SQLite para o usuário autenticado
  async function loadAllData() {
    try {
      // 1. Status de Pagamento / Assinatura PRO do Usuário
      const resPay = await fetch(`/api/payment/status?userId=${currentUser.id}`);
      const dataPay = await resPay.json();
      setIsPremium(dataPay.isPremium);
      setSubscriptionInfo(dataPay.subscription);

      // 2. Empresas do Usuário Autenticado
      const resComp = await fetch(`/api/companies?userId=${currentUser.id}`);
      const dataComp = await resComp.json();
      setEmpresas(dataComp.companies || []);

      if (dataComp.companies && dataComp.companies.length > 0 && !empresaAtivaId) {
        setEmpresaAtivaId(dataComp.companies[0].id);
      }

      // 3. Materiais do Almoxarifado
      const resMat = await fetch('/api/inventory');
      const dataMat = await resMat.json();
      setMateriais(dataMat.materials || []);

      // 4. Solicitações e Entregas
      const resReq = await fetch('/api/requests');
      const dataReq = await resReq.json();
      setSolicitacoes(dataReq.requests || []);

      // 5. Riscos do Usuário
      const resRisk = await fetch(`/api/risks?userId=${currentUser.id}`);
      const dataRisk = await resRisk.json();
      setAnalisesRiscos(dataRisk.analyses || []);

      // 6. Auditoria do Usuário em Tempo Real
      const resAudit = await fetch(`/api/audit?userId=${currentUser.id}`);
      const dataAudit = await resAudit.json();
      setAuditLogs(dataAudit.logs || []);
    } catch (err) {
      console.error('Erro ao carregar dados do servidor:', err);
      showToast('Erro ao sincronizar com o banco SQLite local.', 'error');
    }
  }

  // 4. Salvar estado de navegação automaticamente (onde parou)
  useEffect(() => {
    if (!currentUser) return;
    const timeout = setTimeout(() => {
      fetch('/api/session/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          currentTab: tab,
          currentCompanyId: empresaAtivaId
        })
      }).catch(err => console.warn('Erro ao salvar estado:', err));
    }, 1000);
    return () => clearTimeout(timeout);
  }, [tab, empresaAtivaId, currentUser]);

  // Recarregar dados específicos quando empresaAtiva muda
  const empresaAtiva = empresas.find(e => e.id === empresaAtivaId) || (empresas.length > 0 ? empresas[0] : null);
  const materiaisAtivos = empresaAtiva ? materiais.filter(m => m.empresa_id === empresaAtiva.id) : [];
  const solicitacoesAtivas = empresaAtiva ? solicitacoes.filter(s => s.empresa_id === empresaAtiva.id) : [];
  const analisesAtivas = empresaAtiva ? analisesRiscos.filter(a => a.empresa_id === empresaAtiva.id) : [];

  const contagemPendentes = solicitacoes.filter(s => s.status === 'aberta').length;
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Módulos mestres do sistema SST PRO
  const ALL_SYSTEM_TABS = [
    { id: "empresas", label: "Empresas", icon: "apartment", module: "empresas" },
    { id: "reconhecimento", label: "Análise de Riscos", icon: "security", module: "riscos" },
    { id: "almoxarifado", label: "Almoxarifado & Estoque", icon: "inventory_2", module: "almoxarifado" },
    { id: "solicitacoes", label: "Solicitações & Baixas", icon: "assignment_turned_in", module: "solicitacoes" },
    { id: "auditoria", label: "Auditoria em Tempo Real", icon: "history_toggle_off", module: "auditoria" },
    { id: "usuarios", label: "Gestão de Equipe", icon: "group", module: "usuarios" },
  ];

  // RBAC: Calcular quais módulos o usuário logado tem permissão de acessar
  const allowedModulesList = React.useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'admin' || currentUser.username === 'admin') {
      return ['empresas', 'riscos', 'almoxarifado', 'solicitacoes', 'auditoria', 'usuarios'];
    }
    const raw = currentUser.allowed_modules || 'riscos';
    return raw.split(',').map(s => s.trim().toLowerCase());
  }, [currentUser]);

  // Filtrar abas visíveis estritamente conforme as permissões do usuário
  const TABS = React.useMemo(() => {
    return ALL_SYSTEM_TABS.filter(t => {
      if (t.module === 'riscos') return allowedModulesList.includes('riscos') || allowedModulesList.includes('reconhecimento');
      return allowedModulesList.includes(t.module);
    }).map(t => ({
      ...t,
      badge: t.id === 'solicitacoes' ? contagemPendentes : 0
    }));
  }, [allowedModulesList, contagemPendentes]);

  // Redirecionamento automático: se a aba ativa não for permitida, abrir a primeira permitida
  useEffect(() => {
    if (TABS.length > 0 && !TABS.some(t => t.id === tab)) {
      setTab(TABS[0].id);
    }
  }, [TABS, tab]);

  // Logout Totalmente Independente
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser?.id,
          username: currentUser?.username,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });
    } catch (e) { }
    sessionStorage.removeItem('sst_pro_user');
    localStorage.removeItem('sst_pro_user');
    setCurrentUser(null);
    setEmpresas([]);
    setMateriais([]);
    setSolicitacoes([]);
    setAnalisesRiscos([]);
    setAuditLogs([]);
    setEmpresaAtivaId(null);
    showToast('Sessão encerrada com sucesso.', 'info');
  };

  // Se não estiver autenticado, exibir Tela de Login
  if (isLoadingAuth) {
    return (
      <div className="login-container">
        <div style={{ textAlign: 'center', color: '#fff' }}>
          <Icon name="health_and_safety" style={{ fontSize: '48px', color: '#3b82f6', marginBottom: '16px' }} />
          <h2>Carregando SST PRO...</h2>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <React.Fragment>
        <LoginScreen
          onLoginSuccess={(user, savedSession) => {
            setCurrentUser(user);
            sessionStorage.setItem('sst_pro_user', JSON.stringify(user));
            localStorage.setItem('sst_pro_user', JSON.stringify(user));
            if (savedSession) {
              if (savedSession.currentTab) setTab(savedSession.currentTab);
              if (savedSession.currentCompanyId) setEmpresaAtivaId(savedSession.currentCompanyId);
            }
            showToast(`Acesso autorizado! Bem-vindo, ${user.name}.`, 'success');
          }}
          geoCoords={geoCoords}
          showToast={showToast}
        />
        <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      {/* Backdrop para Menu Mobile */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-backdrop" onClick={() => setMobileMenuOpen(false)} />
      )}

      {/* BARRA LATERAL (Sidebar / Drawer Mobile) */}
      <div className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand-icon">
            <Icon name="health_and_safety" style={{ fontSize: '24px' }} />
          </div>
          <div style={{ flex: 1 }}>
            <h1 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px' }}>SST PRO</h1>
            <a href="https://sst-pro.onrender.com" target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
              sst-pro.onrender.com
            </a>
          </div>
          {mobileMenuOpen && (
            <button
              onClick={() => setMobileMenuOpen(false)}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
            >
              <Icon name="close" style={{ fontSize: '22px' }} />
            </button>
          )}
        </div>

        <div className="sidebar-nav">
          <div className="nav-section-title">Menu de Acesso ({TABS.length} Módulos)</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => {
                setTab(t.id);
                setMobileMenuOpen(false);
              }}
            >
              <Icon name={t.icon} style={{ fontSize: '20px' }} />
              <span style={{ flex: 1 }}>{t.label}</span>

              {t.badge > 0 && (
                <span className="nav-counter alert" title={`${t.badge} solicitações pendentes`}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Rodapé da Sidebar com Usuário Logado */}
        <div className="sidebar-footer">
          <div className="user-profile-box">
            <div className="user-avatar">
              {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'T'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {currentUser.name}
              </div>
              <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600 }}>
                {currentUser.role === 'admin' ? 'Administrador' : (currentUser.registration_number || 'Técnico SST')}
              </div>
            </div>
            <button
              onClick={() => setPerfilModalOpen(true)}
              title="Meu Perfil"
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px' }}
            >
              <Icon name="settings" style={{ fontSize: '18px' }} />
            </button>
            <button
              onClick={handleLogout}
              title="Sair do Sistema"
              style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
            >
              <Icon name="logout" style={{ fontSize: '18px' }} />
            </button>
          </div>
        </div>
      </div>

      {/* ÁREA PRINCIPAL (Main Area) */}
      <div className="main-area">
        {/* TOPBAR RESPONSIVA */}
        <div className="topbar">
          <div className="topbar-left">
            {/* Botão Hambúrguer Mobile */}
            <button
              className="mobile-hamburger-btn"
              onClick={() => setMobileMenuOpen(true)}
              title="Abrir Menu"
            >
              <Icon name="menu" style={{ fontSize: '24px' }} />
            </button>

            {empresas.length > 0 && !["empresas", "auditoria", "usuarios"].includes(tab) ? (
              <div className="company-selector-box">
                <Icon name="domain" style={{ color: '#2563eb', fontSize: '18px' }} />
                <span className="hide-mobile" style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Empresa:</span>
                <select
                  className="select"
                  style={{ margin: 0, padding: '4px 8px', maxWidth: '280px', background: '#fff', border: '1px solid #cbd5e1' }}
                  value={empresaAtivaId || ""}
                  onChange={(e) => setEmpresaAtivaId(e.target.value)}
                >
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} ({e.porte === 'pequeno' ? 'Pequeno Porte' : 'Médio/Grande'})
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="live-pulse"></span>
                <span style={{ color: '#64748b', fontSize: '13px', fontWeight: 500 }}>
                  SST PRO • {currentUser.name} ({currentUser.role === 'admin' ? 'Acesso Total' : `${TABS.length} Módulos`})
                </span>
              </div>
            )}
          </div>

          <div className="topbar-right">
            <div className="badge badge-pro" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Icon name="verified_user" style={{ fontSize: '15px', color: '#10b981' }} />
              <span>SISTEMA ATIVO & CONECTADO</span>
            </div>
          </div>
        </div>

        {/* CONTEÚDO DA ABA SELECIONADA */}
        <div className="content-wrapper">
          <div className="container">
            <React.Fragment>
              {tab === "empresas" && (
                <TabEmpresas
                  empresas={empresas}
                  currentUser={currentUser}
                  geoCoords={geoCoords}
                  onRefresh={loadAllData}
                  setEmpresaAtivaId={setEmpresaAtivaId}
                  showToast={showToast}
                />
              )}

              {tab === "reconhecimento" && (
                <TabReconhecimento
                  empresaAtiva={empresaAtiva}
                  analises={analisesAtivas}
                  currentUser={currentUser}
                  geoCoords={geoCoords}
                  onRefresh={loadAllData}
                  showToast={showToast}
                />
              )}

              {tab === "almoxarifado" && (
                <TabAlmoxarifado
                  empresaAtiva={empresaAtiva}
                  materiais={materiaisAtivos}
                  currentUser={currentUser}
                  geoCoords={geoCoords}
                  onRefresh={loadAllData}
                  showToast={showToast}
                />
              )}

              {tab === "solicitacoes" && (
                <TabSolicitacoes
                  empresaAtiva={empresaAtiva}
                  materiaisAtivos={materiaisAtivos}
                  solicitacoes={solicitacoesAtivas}
                  isPremium={true}
                  currentUser={currentUser}
                  geoCoords={geoCoords}
                  onRefresh={loadAllData}
                  onOpenTermo={(req) => setTermoModalData(req)}
                  showToast={showToast}
                />
              )}

              {tab === "auditoria" && (
                <TabAuditoria
                  auditLogs={auditLogs}
                  onRefresh={loadAllData}
                />
              )}

              {tab === "usuarios" && (
                <TabUsuarios
                  currentUser={currentUser}
                  onRefresh={loadAllData}
                  showToast={showToast}
                />
              )}
            </React.Fragment>
          </div>
        </div>

        {/* BARRA DE NAVEGAÇÃO RÁPIDA MOBILE (Bottom Bar para Celular) */}
        <div className="mobile-bottom-nav">
          {TABS.slice(0, 5).map((t) => (
            <button
              key={t.id}
              className={`mobile-nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} style={{ fontSize: '22px' }} />
              <span>{t.label.split(' ')[0]}</span>
              {t.badge > 0 && <span className="mobile-badge">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* MODAL: TERMO DE ENTREGA E BAIXA DE EPI */}
      {termoModalData && (
        <TermoEntregaModal
          request={termoModalData}
          empresaAtiva={empresaAtiva}
          onClose={() => setTermoModalData(null)}
        />
      )}

      {/* MODAL: PERFIL DO TÉCNICO RESPONSÁVEL */}
      {perfilModalOpen && (
        <PerfilTecnicoModal
          currentUser={currentUser}
          geoCoords={geoCoords}
          onClose={() => setPerfilModalOpen(false)}
          onUpdate={(updated) => {
            setCurrentUser(updated);
            localStorage.setItem('sst_pro_user', JSON.stringify(updated));
            showToast('Perfil atualizado com sucesso!', 'success');
          }}
          showToast={showToast}
        />
      )}

      {/* CONTAINER DE TOASTS */}
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
    </React.Fragment>
  );
}

// =========================================================================
// TELA DE LOGIN PRIVADA E INDEPENDENTE PARA CADA TÉCNICO
// =========================================================================
function LoginScreen({ onLoginSuccess, geoCoords, showToast }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Informe seu usuário e senha.");
      return;
    }

    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          password: password.trim(),
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao autenticar.');
      }

      onLoginSuccess(data.user, data.savedSession);
    } catch (err) {
      setErrorMsg(err.message);
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon-badge">
            <Icon name="health_and_safety" style={{ fontSize: '36px' }} />
          </div>
          <h1 className="login-title">SST PRO</h1>
          <a href="https://sstpro.com.br" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', fontSize: '13px', fontWeight: 600, textDecoration: 'none', display: 'block', marginBottom: '4px' }}>
            https://sstpro.com.br
          </a>
          <p className="login-subtitle">Acesso Restrito ao Técnico de Segurança do Trabalho</p>
        </div>

        {errorMsg && (
          <div style={{ background: '#fee2e2', border: '1px solid #fecaca', color: '#dc2626', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="error" style={{ fontSize: '18px' }} />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleLogin}>
          <label className="label">Usuário / Identificação</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Digite o usuário (ex: admin)"
              autoFocus
              required
            />
          </div>

          <label className="label">Senha de Acesso</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Digite a senha (ex: 1234)"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: '12px', top: '12px', background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
            >
              <Icon name={showPassword ? "visibility_off" : "visibility"} style={{ fontSize: '20px' }} />
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ padding: '14px', fontSize: '15px', marginTop: '8px' }}
          >
            {loading ? (
              <React.Fragment>
                <Icon name="sync" style={{ animation: 'spin 1s linear infinite' }} /> Validando Acesso...
              </React.Fragment>
            ) : (
              <React.Fragment>
                <Icon name="login" /> Entrar no Sistema
              </React.Fragment>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// =========================================================================
// ABA 1: EMPRESAS (Cadastro e Gerenciamento)
// =========================================================================
function TabEmpresas({ empresas, currentUser, geoCoords, onRefresh, setEmpresaAtivaId, showToast }) {
  const [nome, setNome] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [porte, setPorte] = useState("pequeno");
  const [endereco, setEndereco] = useState("");
  const [responsavel, setResponsavel] = useState("");
  const [loading, setLoading] = useState(false);
  const [searchingCnpj, setSearchingCnpj] = useState(false);

  const cleanCnpjDigits = cnpj.replace(/\D/g, '');
  const isCnpjComplete = cleanCnpjDigits.length === 14;
  const isCnpjValid = validateCNPJ(cnpj);

  // Busca automática dos dados da empresa na Receita Federal ao informar CNPJ
  const handleBuscarCNPJ = async (cnpjValue) => {
    const raw = (cnpjValue || cnpj).replace(/\D/g, '');
    if (raw.length !== 14 || !validateCNPJ(raw)) return;

    setSearchingCnpj(true);
    try {
      const res = await fetch(`/api/cnpj/lookup/${raw}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Não foi possível localizar os dados do CNPJ.');

      if (data.nome || data.razaoSocial) {
        setNome(data.nome || data.razaoSocial);
      }
      if (data.endereco) {
        setEndereco(data.endereco);
      }
      if (data.porte) {
        setPorte(data.porte);
      }
      showToast(`✓ Dados de '${data.nome || data.razaoSocial}' preenchidos automaticamente via Receita Federal!`, "success");
    } catch (err) {
      console.warn('Consulta CNPJ:', err.message);
    } finally {
      setSearchingCnpj(false);
    }
  };

  const handleCnpjChange = (e) => {
    const masked = maskCNPJ(e.target.value);
    setCnpj(masked);
    const raw = masked.replace(/\D/g, '');
    if (raw.length === 14 && validateCNPJ(raw)) {
      handleBuscarCNPJ(raw);
    }
  };

  const handleSalvar = async (e) => {
    if (e) e.preventDefault();
    if (!nome.trim()) return showToast("Informe a Razão Social da empresa.", "error");

    if (cnpj.trim() && cleanCnpjDigits.length > 0) {
      if (cleanCnpjDigits.length < 14) {
        return showToast("O CNPJ deve conter 14 dígitos completos no formato 00.000.000/0001-00.", "error");
      }
      if (!validateCNPJ(cnpj)) {
        return showToast("CNPJ inválido! Os dígitos verificadores não conferem com o padrão oficial da Receita Federal.", "error");
      }
    }

    setLoading(true);
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: nome.trim(),
          cnpj: cnpj.trim(),
          porte,
          valorMensalidade: porte === 'pequeno' ? 1500 : 2500,
          endereco: endereco.trim(),
          responsavel: responsavel.trim(),
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(`Empresa '${nome}' cadastrada com sucesso!`, 'success');
      setNome(""); setCnpj(""); setEndereco(""); setResponsavel("");
      onRefresh();
      if (data.company) setEmpresaAtivaId(data.company.id);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleExcluir = async (id, compNome) => {
    if (!confirm(`Deseja realmente remover a empresa '${compNome}' e todos os seus dados?`)) return;
    try {
      const res = await fetch(`/api/companies/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id, username: currentUser?.name })
      });
      if (!res.ok) throw new Error('Erro ao excluir empresa.');
      showToast(`Empresa '${compNome}' removida.`, 'info');
      onRefresh();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="grid-layout">
      {/* Formulário de Cadastro */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="domain_add" style={{ color: '#2563eb' }} />
            <span>Cadastrar Nova Empresa</span>
          </div>
        </div>

        <form onSubmit={handleSalvar}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
            <label className="label" style={{ marginBottom: 0 }}>CNPJ da Empresa</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {searchingCnpj && (
                <span style={{ fontSize: '11px', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Icon name="sync" style={{ animation: 'spin 1s linear infinite', fontSize: '13px' }} />
                  Buscando na Receita Federal...
                </span>
              )}
              {cleanCnpjDigits.length > 0 && !searchingCnpj && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: isCnpjComplete ? (isCnpjValid ? '#16a34a' : '#dc2626') : '#64748b' }}>
                  {isCnpjComplete ? (isCnpjValid ? '✓ CNPJ Válido' : '⚠️ CNPJ Inválido') : `${cleanCnpjDigits.length}/14 dígitos`}
                </span>
              )}
            </div>
          </div>
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input
              className="input"
              value={cnpj}
              onChange={handleCnpjChange}
              onBlur={() => { if (cleanCnpjDigits.length === 14 && isCnpjValid && (!nome || !endereco)) handleBuscarCNPJ(cnpj); }}
              placeholder="00.000.000/0001-00"
              maxLength="18"
              style={{
                borderColor: cleanCnpjDigits.length === 14 ? (isCnpjValid ? '#10b981' : '#ef4444') : undefined,
                paddingRight: '40px'
              }}
            />
            <button
              type="button"
              onClick={() => handleBuscarCNPJ(cnpj)}
              disabled={!isCnpjComplete || !isCnpjValid || searchingCnpj}
              title="Buscar dados da empresa na Receita Federal"
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: isCnpjComplete && isCnpjValid ? '#2563eb' : '#94a3b8',
                cursor: isCnpjComplete && isCnpjValid ? 'pointer' : 'default',
                padding: '4px'
              }}
            >
              <Icon name={searchingCnpj ? "sync" : "search"} style={{ fontSize: '18px', animation: searchingCnpj ? 'spin 1s linear infinite' : 'none' }} />
            </button>
          </div>

          <label className="label">Razão Social / Nome Fantasia *</label>
          <input
            className="input"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Ex: Construtora Alfa Engenharia Ltda (ou preenchido via CNPJ)"
            required
          />

          <label className="label">Porte da Empresa</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            <button
              type="button"
              className={`btn btn-outline ${porte === 'pequeno' ? 'active' : ''}`}
              onClick={() => setPorte('pequeno')}
            >
              <strong>Pequeno Porte</strong>
            </button>

            <button
              type="button"
              className={`btn btn-outline ${porte === 'medio_grande' ? 'active' : ''}`}
              onClick={() => setPorte('medio_grande')}
            >
              <strong>Médio / Grande</strong>
            </button>
          </div>

          <label className="label">Endereço / Canteiro de Obras</label>
          <input
            className="input"
            value={endereco}
            onChange={(e) => setEndereco(e.target.value)}
            placeholder="Ex: Av. Paulista, 1000 - Canteiro 4"
          />

          <label className="label">Responsável Técnico / Contato na Empresa</label>
          <input
            className="input"
            value={responsavel}
            onChange={(e) => setResponsavel(e.target.value)}
            placeholder="Ex: Eng. Carlos Drummond"
          />

          <button type="submit" className="btn btn-primary" disabled={loading}>
            <Icon name="save" /> Salvar Empresa no Banco Local
          </button>
        </form>
      </div>

      {/* Listagem de Empresas Gerenciadas */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            Empresas Gerenciadas ({empresas.length})
          </h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Salvo no SQLite Local</span>
        </div>

        {empresas.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
            <Icon name="domain_disabled" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }} />
            <p>Nenhuma empresa cadastrada ainda no banco local.</p>
          </div>
        ) : (
          <div className="grid-cards">
            {empresas.map((e) => (
              <div key={e.id} className="card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <h3 style={{ color: '#0f172a', fontSize: '16px', fontWeight: 700 }}>{e.name}</h3>
                    <button
                      onClick={() => handleExcluir(e.id, e.name)}
                      title="Excluir Empresa"
                      style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', opacity: 0.6 }}
                    >
                      <Icon name="delete" style={{ fontSize: '18px' }} />
                    </button>
                  </div>

                  {e.cnpj && (
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>
                      CNPJ: {e.cnpj}
                    </div>
                  )}

                  {e.endereco && (
                    <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="location_on" style={{ fontSize: '14px' }} /> {e.endereco}
                    </div>
                  )}
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="badge badge-free">
                    {e.porte === 'pequeno' ? 'Pequeno Porte' : 'Médio / Grande'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// ABA 2: ANÁLISE DE RISCOS COM FOTOS (RISCOS INDIVIDUAIS POR FORMULÁRIO)
// =========================================================================
function TabReconhecimento({ empresaAtiva, analises, currentUser, geoCoords, onRefresh, showToast }) {
  const [local, setLocal] = useState("");
  const [setor, setSetor] = useState("");
  const [foto, setFoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

  const [itensRisco, setItensRisco] = useState([
    { id: 1, tipoRisco: "Físico", nivelRisco: "Médio", riscos: "", medidasPreventivas: "" }
  ]);

  const CATEGORIAS_RISCO = [
    { id: "Físico", label: "Físico (Ruído/Calor/Vibração/Radiação)", icon: "hearing" },
    { id: "Químico", label: "Químico (Poeiras/Vapores/Gases/Fumos)", icon: "science" },
    { id: "Biológico", label: "Biológico (Bactérias/Vírus/Fungos/Parasitas)", icon: "coronavirus" },
    { id: "Ergonômico", label: "Ergonômico (Postura/Peso/Esforço Repetitivo)", icon: "accessibility_new" },
    { id: "Acidente / Altura", label: "Acidente / Altura / Choque / Máquinas", icon: "warning" },
    { id: "Psicossocial / Outros", label: "Psicossocial / Outros Riscos Ocupacionais", icon: "security" }
  ];

  const adicionarRisco = () => {
    setItensRisco([
      ...itensRisco,
      { id: Date.now(), tipoRisco: "Acidente / Altura", nivelRisco: "Médio", riscos: "", medidasPreventivas: "" }
    ]);
  };

  const removerRisco = (index) => {
    if (itensRisco.length > 1) {
      setItensRisco(itensRisco.filter((_, i) => i !== index));
    } else {
      showToast("A inspeção deve conter pelo menos um risco.", "warning");
    }
  };

  const atualizarRisco = (index, campo, valor) => {
    const novos = [...itensRisco];
    novos[index][campo] = valor;
    setItensRisco(novos);
  };

  if (!empresaAtiva) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="apartment" style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '12px' }} />
        <h3>Nenhuma empresa selecionada</h3>
        <p style={{ color: '#64748b' }}>Cadastre ou selecione uma empresa na barra superior para registrar análises de riscos.</p>
      </div>
    );
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFoto(ev.target.result);
      };
      reader.readAsDataURL(e.target.files[0]);
    }
  };

  const handleSalvar = async (e) => {
    if (e) e.preventDefault();
    if (!local.trim()) {
      return showToast("Preencha o local / posto de trabalho inspecionado.", "error");
    }

    // Validar se todos os riscos individuais foram preenchidos
    for (let i = 0; i < itensRisco.length; i++) {
      if (!itensRisco[i].riscos.trim()) {
        return showToast(`Preencha a descrição detalhada para o Risco #${i + 1}.`, "error");
      }
    }

    setLoading(true);
    try {
      const res = await fetch('/api/risks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: empresaAtiva.id,
          local: local.trim(),
          setor: setor.trim(),
          items: itensRisco.map(r => ({
            tipoRisco: r.tipoRisco,
            nivelRisco: r.nivelRisco,
            riscos: r.riscos.trim(),
            medidasPreventivas: r.medidasPreventivas.trim()
          })),
          foto,
          registradoPor: currentUser?.name || 'Técnico Responsável',
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(data.message || `${itensRisco.length} risco(s) individual(is) registrado(s) com sucesso!`, "success");
      setLocal(""); setSetor(""); setFoto(null);
      setItensRisco([{ id: 1, tipoRisco: "Físico", nivelRisco: "Médio", riscos: "", medidasPreventivas: "" }]);
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleExcluir = async (id) => {
    if (!confirm("Excluir este relatório de inspeção?")) return;
    try {
      const res = await fetch(`/api/risks/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id, username: currentUser?.name })
      });
      if (!res.ok) throw new Error("Erro ao excluir inspeção.");
      showToast("Inspeção excluída.", "info");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="grid-layout">
      {/* Formulário de Registro de Riscos Individuais */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="security" style={{ color: '#2563eb' }} />
            <span>Nova Inspeção de Riscos Individuais</span>
          </div>
          <span className="badge badge-free">{empresaAtiva.name}</span>
        </div>

        <form onSubmit={handleSalvar}>
          <label className="label">Local / Posto de Trabalho *</label>
          <input
            className="input"
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            placeholder="Ex: Torre A - 5º Andar / Galpão de Pintura"
            required
          />

          <label className="label">Setor / Área Operacional</label>
          <input
            className="input"
            value={setor}
            onChange={(e) => setSetor(e.target.value)}
            placeholder="Ex: Produção, Manutenção, Obras"
          />

          <label className="label">Evidência Fotográfica de Campo (Câmera / Upload)</label>
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <div className="photo-box" onClick={() => fileInputRef.current.click()}>
            {foto ? (
              <React.Fragment>
                <img src={foto} alt="Evidência Fotográfica" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setFoto(null); }}
                  style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.7)', color: '#fff', border: 'none', borderRadius: '50%', padding: '6px', cursor: 'pointer' }}
                >
                  <Icon name="close" style={{ fontSize: '16px' }} />
                </button>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <Icon name="photo_camera" style={{ fontSize: '36px', color: '#94a3b8', marginBottom: '8px' }} />
                <span style={{ fontSize: '14px', color: '#475569', fontWeight: 600 }}>
                  Clique para tirar foto ou anexar imagem da inspeção
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Gravado no banco SQLite local com geolocalização</span>
              </React.Fragment>
            )}
          </div>

          {/* Lista de Riscos Individuais */}
          <div style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '13px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                🛡️ Riscos Identificados no Local ({itensRisco.length})
              </strong>
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: 'auto', padding: '4px 10px', fontSize: '12px', borderColor: '#2563eb', color: '#2563eb' }}
                onClick={adicionarRisco}
              >
                <Icon name="add" style={{ fontSize: '16px' }} /> + Adicionar Outro Risco
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {itensRisco.map((item, index) => (
                <div
                  key={item.id || index}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '14px',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="warning" style={{ fontSize: '16px' }} />
                      Risco Individual #{index + 1}
                    </span>
                    {itensRisco.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removerRisco(index)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}
                        title="Remover este risco"
                      >
                        <Icon name="delete" style={{ fontSize: '16px' }} /> Remover
                      </button>
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '8px' }}>
                    <div>
                      <label className="label" style={{ fontSize: '12px' }}>Categoria do Risco *</label>
                      <select
                        className="select"
                        value={item.tipoRisco}
                        onChange={(e) => atualizarRisco(index, 'tipoRisco', e.target.value)}
                      >
                        {CATEGORIAS_RISCO.map(c => (
                          <option key={c.id} value={c.id}>{c.label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="label" style={{ fontSize: '12px' }}>Severidade *</label>
                      <select
                        className="select"
                        value={item.nivelRisco}
                        onChange={(e) => atualizarRisco(index, 'nivelRisco', e.target.value)}
                      >
                        <option value="Baixo">Baixo (Tolerável)</option>
                        <option value="Médio">Médio (Atenção)</option>
                        <option value="Alto">Alto (Grave)</option>
                        <option value="Crítico">Crítico (Iminente)</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ marginTop: '8px' }}>
                    <label className="label" style={{ fontSize: '12px' }}>Descrição Detalhada do Risco *</label>
                    <textarea
                      className="textarea"
                      style={{ height: '70px', resize: 'vertical' }}
                      value={item.riscos}
                      onChange={(e) => atualizarRisco(index, 'riscos', e.target.value)}
                      placeholder="Descreva a não-conformidade, fontes geradoras e perigos..."
                      required
                    />
                  </div>

                  <div style={{ marginTop: '8px' }}>
                    <label className="label" style={{ fontSize: '12px' }}>Medidas Preventivas / Recomendações</label>
                    <textarea
                      className="textarea"
                      style={{ height: '60px', resize: 'vertical' }}
                      value={item.medidasPreventivas}
                      onChange={(e) => atualizarRisco(index, 'medidasPreventivas', e.target.value)}
                      placeholder="EPIs, EPCs ou procedimentos de segurança recomendados..."
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '16px' }}>
            <Icon name="save" /> Registrar Inspeção com ({itensRisco.length}) Risco(s)
          </button>
        </form>
      </div>

      {/* Lista de Relatórios de Inspeção Salvos */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            Inspeções Registradas ({analises.length})
          </h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{empresaAtiva.name}</span>
        </div>

        {analises.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
            <Icon name="task_alt" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }} />
            <p>Nenhuma inspeção de risco registrada para esta empresa.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {analises.map((a) => (
              <div key={a.id} className="card" style={{ display: 'flex', gap: '20px', padding: '20px' }}>
                {a.foto ? (
                  <img
                    src={a.foto}
                    alt="Evidência"
                    style={{ width: '120px', height: '120px', borderRadius: '10px', objectFit: 'cover', flexShrink: 0, border: '1px solid #e2e8f0' }}
                  />
                ) : (
                  <div style={{ width: '120px', height: '120px', borderRadius: '10px', background: '#f1f5f9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: '#94a3b8' }}>
                    <Icon name="image_not_supported" style={{ fontSize: '32px' }} />
                    <span style={{ fontSize: '11px', marginTop: '4px' }}>Sem Foto</span>
                  </div>
                )}

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                    <div>
                      <h4 style={{ color: '#0f172a', fontSize: '16px', fontWeight: 700 }}>{a.local}</h4>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
                        <span className={`badge ${a.nivel_risco === 'Crítico' || a.nivel_risco === 'Alto' ? 'badge-danger' : a.nivel_risco === 'Médio' ? 'badge-warning' : 'badge-success'}`}>
                          Nível {a.nivel_risco}
                        </span>
                        {(a.tipo_risco || 'Físico').split(',').map((t, idx) => (
                          <span key={idx} className="badge badge-free" style={{ fontSize: '11px' }}>
                            {t.trim()}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>{a.data}</span>
                      <button onClick={() => handleExcluir(a.id)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>
                        <Icon name="delete" style={{ fontSize: '18px' }} />
                      </button>
                    </div>
                  </div>

                  <p style={{ fontSize: '14px', color: '#334155', lineHeight: '1.5', margin: '10px 0 6px 0' }}>
                    <strong>Risco:</strong> {a.riscos}
                  </p>

                  {a.medidas_preventivas && (
                    <p style={{ fontSize: '13px', color: '#059669', background: '#ecfdf5', padding: '6px 10px', borderRadius: '6px', marginTop: '6px' }}>
                      <strong>Medida Recomendada:</strong> {a.medidas_preventivas}
                    </p>
                  )}

                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                    Inspecionado por: {a.registrado_por}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// ABA 3: ALMOXARIFADO & ESTOQUE DE EPI (COM CONTROLE DE BAIXA)
// =========================================================================
function TabAlmoxarifado({ empresaAtiva, materiais, currentUser, geoCoords, onRefresh, showToast }) {
  const [identificacao, setIdentificacao] = useState("");
  const [caNumber, setCaNumber] = useState("");
  const [categoria, setCategoria] = useState("Proteção Cabeça");
  const [quantidade, setQuantidade] = useState("");
  const [estoqueMinimo, setEstoqueMinimo] = useState("5");
  const [unidade, setUnidade] = useState("un");
  const [loading, setLoading] = useState(false);

  if (!empresaAtiva) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="inventory_2" style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '12px' }} />
        <h3>Nenhuma empresa selecionada</h3>
        <p style={{ color: '#64748b' }}>Selecione uma empresa na barra superior para acessar o almoxarifado.</p>
      </div>
    );
  }

  const handleSalvar = async (e) => {
    if (e) e.preventDefault();
    if (!identificacao.trim() || !quantidade) {
      return showToast("Preencha o nome do EPI e a quantidade inicial.", "error");
    }

    setLoading(true);
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: empresaAtiva.id,
          identificacao: identificacao.trim(),
          caNumber: caNumber.trim() || 'CA N/I',
          categoria,
          quantidadeDisponivel: Number(quantidade),
          estoqueMinimo: Number(estoqueMinimo),
          unidade,
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(`EPI '${identificacao}' adicionado ao estoque do almoxarifado!`, "success");
      setIdentificacao(""); setCaNumber(""); setQuantidade("");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleAtualizarEstoque = async (mat, delta) => {
    const novaQtd = Math.max(0, mat.quantidade_disponivel + delta);
    try {
      const res = await fetch(`/api/inventory/${mat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantidadeDisponivel: novaQtd,
          userId: currentUser?.id,
          username: currentUser?.name
        })
      });
      if (!res.ok) throw new Error("Erro ao ajustar estoque.");
      showToast(`Estoque de '${mat.identificacao}' atualizado para ${novaQtd} ${mat.unidade}.`, "info");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  const handleExcluir = async (id, matNome) => {
    if (!confirm(`Remover o EPI '${matNome}' do almoxarifado?`)) return;
    try {
      const res = await fetch(`/api/inventory/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id, username: currentUser?.name })
      });
      if (!res.ok) throw new Error("Erro ao excluir item.");
      showToast(`EPI '${matNome}' removido do almoxarifado.`, "info");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="grid-layout">
      {/* Cadastro de EPI */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="add_box" style={{ color: '#2563eb' }} />
            <span>Cadastrar Material / EPI no Almoxarifado</span>
          </div>
        </div>

        <form onSubmit={handleSalvar}>
          <label className="label">Identificação do EPI / Material *</label>
          <input
            className="input"
            value={identificacao}
            onChange={(e) => setIdentificacao(e.target.value)}
            placeholder="Ex: Óculos de Segurança Ampla Visão"
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Certificado de Aprovação (CA)</label>
              <input
                className="input"
                value={caNumber}
                onChange={(e) => setCaNumber(e.target.value)}
                placeholder="Ex: CA 34.567"
              />
            </div>

            <div>
              <label className="label">Categoria</label>
              <select className="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
                <option value="Proteção Cabeça">Proteção Cabeça (Capacetes)</option>
                <option value="Proteção Auditiva">Proteção Auditiva (Protetores)</option>
                <option value="Proteção Visual">Proteção Visual / Facial</option>
                <option value="Mãos e Braços">Mãos e Braços (Luvas/Mangas)</option>
                <option value="Pés e Pernas">Pés e Pernas (Botinas)</option>
                <option value="Trabalho em Altura">Trabalho em Altura (Cintos)</option>
                <option value="Proteção Respiratória">Proteção Respiratória</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
            <div>
              <label className="label">Qtd Inicial *</label>
              <input
                className="input"
                type="number"
                min="0"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                placeholder="Ex: 50"
                required
              />
            </div>

            <div>
              <label className="label">Estoque Mínimo</label>
              <input
                className="input"
                type="number"
                min="0"
                value={estoqueMinimo}
                onChange={(e) => setEstoqueMinimo(e.target.value)}
                placeholder="Ex: 5"
              />
            </div>

            <div>
              <label className="label">Unidade</label>
              <select className="select" value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="un">un (unidade)</option>
                <option value="par">par</option>
                <option value="cx">cx (caixa)</option>
                <option value="m">m (metro)</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '8px' }}>
            <Icon name="add" /> Adicionar ao Estoque do Almoxarifado
          </button>
        </form>
      </div>

      {/* Inventário Atual de EPIs com Status em Tempo Real */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            Inventário & Almoxarifado ({materiais.length} Itens)
          </h2>
          <span style={{ fontSize: '12px', color: '#64748b' }}>{empresaAtiva.name}</span>
        </div>

        {materiais.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
            <Icon name="inventory" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }} />
            <p>Almoxarifado vazio para esta empresa. Cadastre os primeiros EPIs acima.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {materiais.map((m) => {
              const isBaixo = m.quantidade_disponivel <= (m.estoque_minimo || 5) && m.quantidade_disponivel > 0;
              const isEsgotado = m.quantidade_disponivel === 0;

              return (
                <div key={m.id} className="list-item">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ color: '#0f172a', fontSize: '15px' }}>{m.identificacao}</strong>
                      <span className="badge badge-free" style={{ fontSize: '11px' }}>{m.ca_number || 'S/ CA'}</span>
                      <span className="badge badge-free" style={{ fontSize: '11px' }}>{m.categoria}</span>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '12px', color: '#64748b' }}>
                      <span>Mínimo recomendado: <b>{m.estoque_minimo || 5} {m.unidade}</b></span>
                      {isEsgotado && <span style={{ color: '#dc2626', fontWeight: 700 }}>⚠️ ESTOQUE ESGOTADO</span>}
                      {isBaixo && <span style={{ color: '#d97706', fontWeight: 700 }}>⚠️ ESTOQUE BAIXO</span>}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' }}>Saldo Disponível</div>
                      <strong style={{ color: isEsgotado ? '#dc2626' : isBaixo ? '#d97706' : '#16a34a', fontSize: '20px' }}>
                        {m.quantidade_disponivel} <span style={{ fontSize: '13px' }}>{m.unidade}</span>
                      </strong>
                    </div>

                    {/* Botões Rápidos de Ajuste / Reabastecimento */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '6px 10px', width: 'auto' }}
                        title="Adicionar +10 unidades"
                        onClick={() => handleAtualizarEstoque(m, 10)}
                      >
                        +10
                      </button>
                      <button
                        className="btn btn-outline"
                        style={{ padding: '6px 10px', width: 'auto' }}
                        title="Adicionar +1 unidade"
                        onClick={() => handleAtualizarEstoque(m, 1)}
                      >
                        +1
                      </button>
                      <button
                        onClick={() => handleExcluir(m.id, m.identificacao)}
                        title="Excluir EPI"
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '6px' }}
                      >
                        <Icon name="delete" style={{ fontSize: '18px' }} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// ABA 4: SOLICITAÇÕES COM MÚLTIPLOS ITENS E BAIXA AUTOMÁTICA DE EPI NO ALMOXARIFADO
// =========================================================================
function TabSolicitacoes({ empresaAtiva, materiaisAtivos, solicitacoes, isPremium, currentUser, geoCoords, onRefresh, onOpenTermo, showToast }) {
  const [colaborador, setColaborador] = useState("");
  const [funcao, setFuncao] = useState("Colaborador Operacional");
  const [itensPedido, setItensPedido] = useState([
    { id: 1, materialId: "", quantidade: "1", motivo: "Substituição Periódica" }
  ]);
  const [loading, setLoading] = useState(false);

  const adicionarItem = () => {
    setItensPedido([
      ...itensPedido,
      { id: Date.now(), materialId: "", quantidade: "1", motivo: "Substituição Periódica" }
    ]);
  };

  const removerItem = (index) => {
    if (itensPedido.length > 1) {
      setItensPedido(itensPedido.filter((_, i) => i !== index));
    } else {
      showToast("O pedido deve conter pelo menos um item de EPI.", "warning");
    }
  };

  const atualizarItem = (index, campo, valor) => {
    const novos = [...itensPedido];
    novos[index][campo] = valor;
    setItensPedido(novos);
  };

  if (!empresaAtiva) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
        <Icon name="assignment" style={{ fontSize: '48px', color: '#94a3b8', marginBottom: '12px' }} />
        <h3>Nenhuma empresa selecionada</h3>
        <p style={{ color: '#64748b' }}>Selecione uma empresa para gerenciar pedidos e baixas de EPI.</p>
      </div>
    );
  }

  const handleGerarPedido = async (e) => {
    if (e) e.preventDefault();
    if (!colaborador.trim()) {
      return showToast("Preencha o nome do colaborador.", "error");
    }

    // Validar se todos os itens possuem material selecionado
    for (let i = 0; i < itensPedido.length; i++) {
      if (!itensPedido[i].materialId) {
        return showToast(`Selecione o EPI para o item ${i + 1} do pedido.`, "error");
      }
    }

    setLoading(true);
    try {
      const res = await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: empresaAtiva.id,
          colaborador: colaborador.trim(),
          funcaoColaborador: funcao.trim(),
          items: itensPedido.map(it => ({
            materialId: it.materialId,
            quantidade: Number(it.quantidade) || 1,
            motivo: it.motivo
          })),
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(data.message || `Solicitação de ${itensPedido.length} item(ns) de EPI para '${colaborador}' gerada com sucesso!`, "success");
      setColaborador("");
      setItensPedido([{ id: 1, materialId: "", quantidade: "1", motivo: "Substituição Periódica" }]);
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // FUNÇÃO CRUCIAL: BAIXA AUTOMÁTICA NO ESTOQUE AO APROVAR
  const handleAprovarEBaixarEstoque = async (req) => {
    if (!confirm(`Confirmar entrega de ${req.quantidade}x '${req.material_nome}' para o colaborador '${req.colaborador}'?\n\nIsso dará BAIXA AUTOMÁTICA imediata no estoque do almoxarifado sob responsabilidade de ${currentUser?.name || 'Técnico Responsável'}.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/requests/${req.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId: currentUser?.id,
          technicianName: currentUser?.name,
          technicianRegistration: currentUser?.registration_number,
          observacoes: `Entrega técnica realizada e conferida. EPI com CA ${req.ca_number || 'regular'} entregue em perfeitas condições de uso conforme NR-06.`,
          latitude: geoCoords?.lat,
          longitude: geoCoords?.lng,
          locationText: geoCoords?.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao processar baixa.');

      // Disparar confetti visual de celebração da entrega
      if (window.confetti) {
        try {
          window.confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
        } catch (e) { }
      }

      showToast(data.message || 'Baixa realizada com sucesso!', "success");
      
      // Atualizar lista em tempo real sem precisar de F5
      if (typeof onRefresh === 'function') {
        onRefresh();
      }

      // Abrir o Termo de Entrega oficial para conferência e impressão
      if (data.request && typeof onOpenTermo === 'function') {
        onOpenTermo({
          ...data.request,
          empresa_nome: data.request.empresa_nome || empresaAtiva?.name || 'Empresa Contratante'
        });
      }
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="grid-layout">
      {/* Formulário com Múltiplos Itens de EPI */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="front_hand" style={{ color: '#2563eb' }} />
            <span>Gerar Solicitação de EPI (Múltiplos Itens)</span>
          </div>
          <span className="badge badge-free">{empresaAtiva.name}</span>
        </div>

        <form onSubmit={handleGerarPedido}>
          <label className="label">Nome Completo do Colaborador *</label>
          <input
            className="input"
            value={colaborador}
            onChange={(e) => setColaborador(e.target.value)}
            placeholder="Ex: João da Silva Santos"
            required
          />

          <label className="label">Função / Cargo do Colaborador</label>
          <input
            className="input"
            value={funcao}
            onChange={(e) => setFuncao(e.target.value)}
            placeholder="Ex: Eletricista de Manutenção"
          />

          {/* Lista de Itens de EPI */}
          <div style={{ marginTop: '16px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '13px', color: '#0f172a', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                📦 Itens de EPI Solicitados ({itensPedido.length})
              </strong>
              <button
                type="button"
                className="btn btn-outline"
                style={{ width: 'auto', padding: '4px 10px', fontSize: '12px', borderColor: '#2563eb', color: '#2563eb' }}
                onClick={adicionarItem}
              >
                <Icon name="add" style={{ fontSize: '16px' }} /> + Adicionar Outro EPI
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {itensPedido.map((item, index) => (
                <div
                  key={item.id || index}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: '10px',
                    padding: '12px',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: '#2563eb' }}>
                      Item #{index + 1}
                    </span>
                    {itensPedido.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removerItem(index)}
                        style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', padding: '2px 6px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '2px' }}
                        title="Remover este item"
                      >
                        <Icon name="delete" style={{ fontSize: '16px' }} /> Remover
                      </button>
                    )}
                  </div>

                  <label className="label" style={{ fontSize: '12px' }}>EPI no Almoxarifado *</label>
                  <select
                    className="select"
                    value={item.materialId}
                    onChange={(e) => atualizarItem(index, 'materialId', e.target.value)}
                    required
                  >
                    <option value="">Selecione no almoxarifado...</option>
                    {materiaisAtivos.map((m) => (
                      <option key={m.id} value={m.id} disabled={m.quantidade_disponivel <= 0}>
                        {m.identificacao} ({m.ca_number || 'S/ CA'}) — Saldo: {m.quantidade_disponivel} {m.unidade} {m.quantidade_disponivel <= 0 ? '(ESGOTADO)' : ''}
                      </option>
                    ))}
                  </select>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px', marginTop: '8px' }}>
                    <div>
                      <label className="label" style={{ fontSize: '12px' }}>Qtd *</label>
                      <input
                        className="input"
                        type="number"
                        min="1"
                        value={item.quantidade}
                        onChange={(e) => atualizarItem(index, 'quantidade', e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="label" style={{ fontSize: '12px' }}>Motivo</label>
                      <select
                        className="select"
                        value={item.motivo}
                        onChange={(e) => atualizarItem(index, 'motivo', e.target.value)}
                      >
                        <option value="Admissão de Colaborador">Admissão</option>
                        <option value="Substituição Periódica">Substituição Periódica</option>
                        <option value="Desgaste Natural">Desgaste Natural</option>
                        <option value="Perda / Extravio">Perda / Extravio</option>
                        <option value="Início de Atividade Especial / Altura">Atividade Especial</option>
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '16px' }}>
            <Icon name="assignment" /> Gerar Pedido de ({itensPedido.length}) EPI(s)
          </button>
        </form>
      </div>

      {/* Fila de Liberação e Baixa Automática */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
              Fila de Liberação & Entregas ({solicitacoes.length})
            </h2>
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Baixa de estoque automática vinculada ao banco SQLite
            </span>
          </div>
          <span className="badge badge-free">{empresaAtiva.name}</span>
        </div>

        {solicitacoes.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', background: '#fff', borderRadius: '16px', border: '1px dashed #cbd5e1', color: '#64748b' }}>
            <Icon name="task_alt" style={{ fontSize: '48px', color: '#cbd5e1', marginBottom: '12px' }} />
            <p>Nenhuma solicitação de EPI registrada para esta empresa.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {solicitacoes.map((s) => {
              const isAberta = s.status === 'aberta';
              const isAprovada = s.status === 'aprovada';

              return (
                <div key={s.id} className="list-item-vertical" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: isAprovada ? '4px solid #10b981' : '4px solid #f59e0b' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <strong style={{ color: '#0f172a', fontSize: '16px' }}>{s.colaborador}</strong>
                      <span className="badge badge-free" style={{ fontSize: '11px' }}>{s.funcao_colaborador || 'Colaborador'}</span>
                    </div>

                    <div style={{ color: '#475569', fontSize: '14px', margin: '6px 0 4px 0' }}>
                      EPI: <strong style={{ color: '#0f172a' }}>{s.quantidade}x {s.material_nome}</strong> {s.ca_number && <span style={{ color: '#64748b', fontSize: '12px' }}>({s.ca_number})</span>}
                    </div>

                    <div style={{ display: 'flex', gap: '14px', fontSize: '12px', color: '#64748b' }}>
                      <span>Motivo: <b>{s.motivo}</b></span>
                      <span>Pedido em: {formatDate(s.data_solicitacao)}</span>
                    </div>

                    {isAprovada && s.aprovado_por_nome && (
                      <div style={{ fontSize: '12px', color: '#059669', marginTop: '6px', background: '#ecfdf5', padding: '4px 8px', borderRadius: '6px', display: 'inline-block' }}>
                        ✓ Entregue & Baixado por: <b>{s.aprovado_por_nome}</b> em {formatDate(s.data_aprovacao)}
                      </div>
                    )}
                  </div>

                  {/* Ações de Aprovação / Baixa */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
                    <span className={`badge ${isAprovada ? 'badge-success' : 'badge-warning'}`}>
                      {isAprovada ? '✓ ENTREGUE & BAIXADO' : 'PENDENTE DE LIBERAÇÃO'}
                    </span>

                    {isAberta && isPremium && (
                      <button
                        className="btn btn-success"
                        style={{ width: 'auto', padding: '8px 16px', fontSize: '13px' }}
                        onClick={() => handleAprovarEBaixarEstoque(s)}
                      >
                        <Icon name="check_circle" style={{ fontSize: '16px' }} /> Aprovar & Dar Baixa no Estoque
                      </button>
                    )}

                    {isAberta && !isPremium && (
                      <div style={{ fontSize: '12px', color: '#d97706', display: 'flex', alignItems: 'center', gap: '4px', background: '#fffbeb', padding: '6px 10px', borderRadius: '6px' }}>
                        <Icon name="lock" style={{ fontSize: '14px' }} /> Requer Assinatura PRO para baixar
                      </div>
                    )}

                    {isAprovada && (
                      <button
                        className="btn btn-outline"
                        style={{ width: 'auto', padding: '6px 12px', fontSize: '12px' }}
                        onClick={() => onOpenTermo(s)}
                      >
                        <Icon name="description" style={{ fontSize: '14px' }} /> Ver Termo de Entrega
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// ABA 5: AUDITORIA E RASTREAMENTO EM TEMPO REAL
// =========================================================================
function TabAuditoria({ auditLogs, onRefresh }) {
  const [filterAction, setFilterAction] = useState("TODOS");

  const filteredLogs = useMemo(() => {
    if (filterAction === "TODOS") return auditLogs;
    return auditLogs.filter(l => l.action.toUpperCase().includes(filterAction));
  }, [auditLogs, filterAction]);

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="card-title-group">
            <span className="live-pulse"></span>
            <span style={{ fontSize: '18px', fontWeight: 800 }}>Rastreamento e Auditoria de Acessos em Tempo Real</span>
          </div>
          <p style={{ fontSize: '13px', color: '#64748b', marginTop: '4px' }}>
            Registro imutável em banco SQLite local com Identificação do Usuário, Data/Hora exata, Coordenadas GPS e Ação executada.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn btn-outline" style={{ width: 'auto', padding: '8px 14px' }} onClick={onRefresh}>
            <Icon name="refresh" /> Atualizar Feed
          </button>
        </div>
      </div>

      {/* Filtros rápidos */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {[
          { label: 'Todos os Eventos', val: 'TODOS' },
          { label: 'Baixas de Estoque (EPI)', val: 'EPI_DELIVERY' },
          { label: 'Logins & Acessos', val: 'LOGIN' },
          { label: 'Inspeções de Risco', val: 'RISK' },
          { label: 'Pagamentos PRO', val: 'PAYMENT' },
          { label: 'Empresas', val: 'COMPANY' }
        ].map((f) => (
          <button
            key={f.val}
            className={`btn btn-outline ${filterAction === f.val ? 'active' : ''}`}
            style={{ width: 'auto', padding: '6px 12px', fontSize: '12px' }}
            onClick={() => setFilterAction(f.val)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Timeline de Auditoria */}
      <div className="timeline">
        {filteredLogs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
            Nenhum registro de auditoria encontrado para o filtro selecionado.
          </div>
        ) : (
          filteredLogs.map((log) => {
            let iconName = 'info';
            let iconBg = '#f1f5f9';
            let iconColor = '#64748b';

            if (log.action.includes('EPI_DELIVERY')) {
              iconName = 'assignment_turned_in';
              iconBg = '#ecfdf5';
              iconColor = '#10b981';
            } else if (log.action.includes('LOGIN')) {
              iconName = 'vpn_key';
              iconBg = '#eff6ff';
              iconColor = '#2563eb';
            } else if (log.action.includes('PAYMENT')) {
              iconName = 'workspace_premium';
              iconBg = '#fef3c7';
              iconColor = '#d97706';
            } else if (log.action.includes('RISK')) {
              iconName = 'security';
              iconBg = '#fee2e2';
              iconColor = '#ef4444';
            }

            return (
              <div key={log.id} className="timeline-item">
                <div className="timeline-icon" style={{ background: iconBg, color: iconColor }}>
                  <Icon name={iconName} style={{ fontSize: '20px' }} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <strong style={{ color: '#0f172a', fontSize: '14px' }}>{log.username}</strong>
                      <span className="badge badge-free" style={{ marginLeft: '8px', fontSize: '11px' }}>
                        {log.action}
                      </span>
                    </div>

                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>
                      {formatDate(log.timestamp)}
                    </div>
                  </div>

                  <p style={{ fontSize: '13px', color: '#334155', marginTop: '6px', lineHeight: '1.4' }}>
                    {log.description}
                  </p>

                  <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="location_on" style={{ fontSize: '13px', color: '#10b981' }} />
                      {log.location_text || (log.latitude ? `${log.latitude.toFixed(4)}, ${log.longitude.toFixed(4)}` : 'Terminal Local')}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Icon name="devices" style={{ fontSize: '13px' }} /> IP: {log.ip_address}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// =========================================================================
// ABA 6: GESTÃO DE EQUIPE, FUNCIONÁRIOS E PERMISSÕES GRANULARES (RBAC)
// =========================================================================
function TabUsuarios({ currentUser, onRefresh, showToast }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalUser, setModalUser] = useState(null); // null = fechado, objeto = edição/novo
  const [syncingGit, setSyncingGit] = useState(false);

  const MODULOS_DISPONIVEIS = [
    { id: "empresas", label: "Empresas", icon: "apartment", desc: "Gestão de Empresas Clientes e Contratos", color: "#2563eb", bg: "#eff6ff" },
    { id: "riscos", label: "Análise de Riscos", icon: "security", desc: "Inspeções de Campo e Evidências Fotográficas", color: "#dc2626", bg: "#fef2f2" },
    { id: "almoxarifado", label: "Almoxarifado", icon: "inventory_2", desc: "Controle de Estoque e Cadastro de EPIs", color: "#d97706", bg: "#fffbeb" },
    { id: "solicitacoes", label: "Solicitações & Baixas", icon: "assignment_turned_in", desc: "Aprovação de Pedidos e Baixa de Estoque", color: "#16a34a", bg: "#f0fdf4" },
    { id: "auditoria", label: "Auditoria em Tempo Real", icon: "history_toggle_off", desc: "Rastreamento Completo de Eventos e Ações", color: "#9333ea", bg: "#faf5ff" }
  ];

  const carregarUsuarios = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      const data = await res.json();
      if (data.users) setUsers(data.users);
    } catch (err) {
      showToast("Erro ao carregar equipe: " + err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    carregarUsuarios();
  }, []);

  const handleSyncGit = async () => {
    setSyncingGit(true);
    try {
      const res = await fetch('/api/git/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: 'Sincronização manual acionada pelo Administrador',
          username: currentUser?.name
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast("🚀 Banco de dados e logs sincronizados com o GitHub com sucesso!", "success");
      } else {
        showToast("Aviso na sincronização: " + (data.message || data.error), "info");
      }
    } catch (err) {
      showToast("Erro ao sincronizar com GitHub: " + err.message, "error");
    } finally {
      setSyncingGit(false);
    }
  };

  const handleExcluirUsuario = async (u) => {
    if (u.username === 'admin' || u.id === 'usr_admin_default') {
      return showToast("O administrador principal não pode ser excluído.", "warning");
    }
    if (!confirm(`Tem certeza que deseja remover o funcionário ${u.name} (@${u.username})?`)) return;

    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deletedBy: currentUser?.id,
          deletedByName: currentUser?.name
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showToast(data.message || "Funcionário removido com sucesso.", "info");
      carregarUsuarios();
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div>
      {/* Top Header da Gestão de Equipe */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '14px', background: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="group" style={{ fontSize: '28px' }} />
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Gestão de Equipe & Permissões</h2>
              <p style={{ fontSize: '13px', color: '#64748b' }}>
                Defina exatamente quais módulos cada funcionário pode acessar dentro do SST PRO
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline"
              style={{ width: 'auto', padding: '10px 16px', borderColor: '#3b82f6', color: '#2563eb' }}
              onClick={handleSyncGit}
              disabled={syncingGit}
            >
              <Icon name="cloud_sync" />
              {syncingGit ? "Sincronizando..." : "Sincronizar com GitHub"}
            </button>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: 'auto', padding: '10px 20px' }}
              onClick={() => setModalUser({ isNew: true, allowed_modules: 'riscos', role: 'technician' })}
            >
              <Icon name="person_add" /> Cadastrar Novo Funcionário
            </button>
          </div>
        </div>
      </div>

      {/* Grid de Cards dos Funcionários */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: '20px' }}>
        {users.map((u) => {
          const modulosArray = (u.allowed_modules || 'riscos').split(',').map(m => m.trim().toLowerCase());
          const isAdmin = u.role === 'admin' || u.username === 'admin';

          return (
            <div key={u.id} className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', border: isAdmin ? '2px solid #93c5fd' : '1px solid #e2e8f0' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{
                      width: '46px',
                      height: '46px',
                      borderRadius: '50%',
                      background: isAdmin ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : '#f1f5f9',
                      color: isAdmin ? '#fff' : '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 800,
                      fontSize: '18px',
                      boxShadow: isAdmin ? '0 4px 10px rgba(37, 99, 235, 0.3)' : 'none'
                    }}>
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: '#0f172a' }}>{u.name}</div>
                      <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: 600 }}>@{u.username}</div>
                    </div>
                  </div>

                  <span className={`badge ${isAdmin ? 'badge-pro' : 'badge-free'}`}>
                    {isAdmin ? 'ADMINISTRADOR' : 'TÉCNICO SST'}
                  </span>
                </div>

                <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '14px', lineHeight: '1.6' }}>
                  <div><strong>Registro MTE:</strong> {u.registration_number || 'Não informado'}</div>
                  <div><strong>E-mail:</strong> {u.email || 'Não informado'}</div>
                  <div><strong>Telefone:</strong> {u.phone || 'Não informado'}</div>
                </div>

                <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '12px', marginBottom: '14px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: '8px' }}>
                    Módulos Liberados:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {MODULOS_DISPONIVEIS.map(m => {
                      const hasModule = isAdmin || modulosArray.includes(m.id);
                      if (!hasModule) return null;
                      return (
                        <span
                          key={m.id}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: m.bg,
                            color: m.color,
                            fontSize: '11px',
                            fontWeight: 600,
                            border: `1px solid ${m.bg}`
                          }}
                        >
                          <Icon name={m.icon} style={{ fontSize: '14px' }} />
                          {m.label}
                        </span>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', borderTop: '1px solid #e2e8f0', paddingTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  style={{ width: 'auto', padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => setModalUser(u)}
                >
                  <Icon name="tune" style={{ fontSize: '16px' }} /> Permissões & Dados
                </button>

                {!isAdmin && (
                  <button
                    type="button"
                    className="btn btn-outline"
                    style={{ width: 'auto', padding: '6px 10px', fontSize: '12px', borderColor: '#fca5a5', color: '#ef4444' }}
                    onClick={() => handleExcluirUsuario(u)}
                    title="Excluir funcionário"
                  >
                    <Icon name="delete" style={{ fontSize: '16px' }} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de Criação / Edição de Funcionário */}
      {modalUser && (
        <UsuarioModal
          user={modalUser}
          modulosDisponiveis={MODULOS_DISPONIVEIS}
          currentUser={currentUser}
          onClose={() => setModalUser(null)}
          onSuccess={() => {
            setModalUser(null);
            carregarUsuarios();
            onRefresh();
          }}
          showToast={showToast}
        />
      )}
    </div>
  );
}

// Modal de Formulário de Funcionário & Permissões
function UsuarioModal({ user, modulosDisponiveis, currentUser, onClose, onSuccess, showToast }) {
  const isNew = Boolean(user.isNew);
  const [name, setName] = useState(user.name || "");
  const [username, setUsername] = useState(user.username || "");
  const [password, setPassword] = useState(user.password || (isNew ? "1234" : ""));
  const [role, setRole] = useState(user.role || "technician");
  const [reg, setReg] = useState(user.registration_number || "");
  const [email, setEmail] = useState(user.email || "");
  const [phone, setPhone] = useState(user.phone || "");
  const [modulos, setModulos] = useState(
    user.allowed_modules ? user.allowed_modules.split(',').map(m => m.trim().toLowerCase()) : ['riscos']
  );
  const [loading, setLoading] = useState(false);

  const toggleModulo = (modId) => {
    if (modulos.includes(modId)) {
      if (modulos.length > 1) {
        setModulos(modulos.filter(m => m !== modId));
      } else {
        showToast("O usuário deve ter acesso a pelo menos 1 módulo.", "warning");
      }
    } else {
      setModulos([...modulos, modId]);
    }
  };

  const aplicarPreset = (presetKey) => {
    if (presetKey === 'victor') {
      setModulos(['empresas', 'riscos', 'solicitacoes', 'auditoria']);
      setRole('technician');
    } else if (presetKey === 'eric') {
      setModulos(['almoxarifado', 'solicitacoes', 'auditoria']);
      setRole('technician');
    } else if (presetKey === 'samuel') {
      setModulos(['riscos']);
      setRole('technician');
    } else if (presetKey === 'admin') {
      setModulos(['empresas', 'riscos', 'almoxarifado', 'solicitacoes', 'auditoria', 'usuarios']);
      setRole('admin');
    }
  };

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!name.trim() || !username.trim()) {
      return showToast("Nome e usuário (@login) são obrigatórios.", "error");
    }
    if (isNew && !password.trim()) {
      return showToast("Defina uma senha inicial para o usuário.", "error");
    }

    setLoading(true);
    try {
      const url = isNew ? '/api/users' : `/api/users/${user.id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          username: username.trim(),
          password: password.trim(),
          role,
          allowedModules: modulos.join(','),
          registrationNumber: reg.trim(),
          email: email.trim(),
          phone: phone.trim(),
          createdBy: currentUser?.id,
          createdByName: currentUser?.name,
          updatedBy: currentUser?.id,
          updatedByName: currentUser?.name
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(data.message || "Funcionário salvo com sucesso!", "success");
      onSuccess();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="person" style={{ fontSize: '28px', color: '#2563eb' }} />
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>
                {isNew ? 'Cadastrar Novo Funcionário' : `Editar: ${user.name}`}
              </h3>
              <span style={{ fontSize: '12px', color: '#64748b' }}>
                Controle de Acessos & Módulos do Sistema
              </span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <Icon name="close" style={{ fontSize: '24px' }} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Atalhos Rápidos / Presets */}
          <div style={{ marginBottom: '16px', background: '#f8fafc', padding: '12px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: '#475569', display: 'block', marginBottom: '8px' }}>
              ⚡ Modelos Rápidos de Permissão:
            </span>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-outline" style={{ width: 'auto', padding: '4px 10px', fontSize: '11px' }} onClick={() => aplicarPreset('victor')}>
                Perfil Victor (Empresas/Riscos/Solicitações/Auditoria)
              </button>
              <button type="button" className="btn btn-outline" style={{ width: 'auto', padding: '4px 10px', fontSize: '11px' }} onClick={() => aplicarPreset('eric')}>
                Perfil Eric (Almoxarifado/Solicitações/Auditoria)
              </button>
              <button type="button" className="btn btn-outline" style={{ width: 'auto', padding: '4px 10px', fontSize: '11px' }} onClick={() => aplicarPreset('samuel')}>
                Perfil Campo (Apenas Riscos)
              </button>
              <button type="button" className="btn btn-outline" style={{ width: 'auto', padding: '4px 10px', fontSize: '11px', borderColor: '#3b82f6', color: '#2563eb' }} onClick={() => aplicarPreset('admin')}>
                Acesso Total Admin
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label className="label">Nome Completo *</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Roberto Silva" required />
            </div>
            <div>
              <label className="label">Usuário de Acesso (@login) *</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Ex: Roberto" required disabled={!isNew && user.username === 'admin'} />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
            <div>
              <label className="label">{isNew ? 'Senha Inicial *' : 'Nova Senha (opcional)'}</label>
              <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isNew ? "1234" : "Deixe em branco para manter"} />
            </div>
            <div>
              <label className="label">Papel / Nível no Sistema</label>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="technician">Técnico SST Operacional</option>
                <option value="admin">Administrador Geral</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label className="label">Registro Profissional MTE</label>
              <input className="input" value={reg} onChange={(e) => setReg(e.target.value)} placeholder="Ex: MTE-SST-004521/SP" />
            </div>
            <div>
              <label className="label">Telefone / Celular</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 98765-4321" />
            </div>
          </div>

          {/* Matriz de Módulos e Permissões */}
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: '16px', marginBottom: '20px' }}>
            <label className="label" style={{ marginBottom: '10px' }}>
              🛡️ Módulos e Abas Permitidas para este Funcionário:
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {modulosDisponiveis.map((m) => {
                const isSelected = modulos.includes(m.id);
                return (
                  <div
                    key={m.id}
                    onClick={() => toggleModulo(m.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '10px 14px',
                      borderRadius: '10px',
                      border: isSelected ? `2px solid ${m.color}` : '1px solid #e2e8f0',
                      background: isSelected ? m.bg : '#ffffff',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Icon name={m.icon} style={{ fontSize: '22px', color: isSelected ? m.color : '#94a3b8' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: 700, color: isSelected ? '#0f172a' : '#64748b' }}>
                        {m.label}
                      </div>
                      <div style={{ fontSize: '11px', color: '#64748b' }}>{m.desc}</div>
                    </div>
                    <Icon name={isSelected ? "check_box" : "check_box_outline_blank"} style={{ color: isSelected ? m.color : '#cbd5e1', fontSize: '22px' }} />
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
            <button type="button" className="btn btn-outline" style={{ width: 'auto' }} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '12px 24px' }} disabled={loading}>
              <Icon name="save" /> {loading ? "Salvando..." : (isNew ? "Criar Funcionário" : "Salvar Permissões")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =========================================================================
// MODAL: PERFIL DO TÉCNICO RESPONSÁVEL
// =========================================================================
function PerfilTecnicoModal({ currentUser, geoCoords, onClose, onUpdate, showToast }) {
  const [name, setName] = useState(currentUser.name || "");
  const [registration, setRegistration] = useState(currentUser.registration_number || "");
  const [email, setEmail] = useState(currentUser.email || "");
  const [phone, setPhone] = useState(currentUser.phone || "");
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSalvar = async (e) => {
    if (e) e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: currentUser.id,
          name: name.trim(),
          registrationNumber: registration.trim(),
          email: email.trim(),
          phone: phone.trim(),
          newPassword: newPassword.trim(),
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onUpdate(data.user);
      onClose();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e2e8f0', paddingBottom: '14px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name="manage_accounts" style={{ fontSize: '24px', color: '#2563eb' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 800 }}>Meu Perfil de Técnico Responsável</h3>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <Icon name="close" />
          </button>
        </div>

        <form onSubmit={handleSalvar}>
          <label className="label">Nome Completo do Técnico *</label>
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <label className="label">Registro Profissional (MTE / CREA / CFT) *</label>
          <input
            className="input"
            value={registration}
            onChange={(e) => setRegistration(e.target.value)}
            placeholder="Ex: MTE-SST-004521/SP"
            required
          />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">E-mail</label>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Telefone / WhatsApp</label>
              <input
                className="input"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <label className="label">Alterar Senha (deixe em branco para manter)</label>
          <input
            className="input"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Digite nova senha se desejar alterar"
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '12px' }}>
            <button type="button" className="btn btn-outline" style={{ width: 'auto' }} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" style={{ width: 'auto' }} disabled={loading}>
              <Icon name="save" /> Salvar Alterações
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Renderizar aplicação
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
