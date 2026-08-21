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

  // 2. Verificar Sessão no Carregamento Inicial
  useEffect(() => {
    async function checkInitialSession() {
      try {
        const storedUser = localStorage.getItem('sst_pro_user');
        if (storedUser) {
          const userObj = JSON.parse(storedUser);
          setCurrentUser(userObj);

          // Buscar onde parou no backend SQLite
          const resSession = await fetch(`/api/session/${userObj.id}`);
          const dataSession = await resSession.json();

          if (dataSession.session) {
            if (dataSession.session.currentTab) setTab(dataSession.session.currentTab);
            if (dataSession.session.currentCompanyId) setEmpresaAtivaId(dataSession.session.currentCompanyId);
            showToast(`Bem-vindo de volta, ${userObj.name}! Sessão restaurada no ponto onde você parou.`, 'success');
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

  // 3. Carregar dados gerais quando logado
  useEffect(() => {
    if (!currentUser) return;
    loadAllData();
  }, [currentUser]);

  // Carregar todos os dados do banco SQLite
  async function loadAllData() {
    try {
      // 1. Status de Pagamento / Assinatura PRO
      const resPay = await fetch('/api/payment/status');
      const dataPay = await resPay.json();
      setIsPremium(dataPay.isPremium);
      setSubscriptionInfo(dataPay.subscription);

      // 2. Empresas
      const resComp = await fetch('/api/companies');
      const dataComp = await resComp.json();
      setEmpresas(dataComp.companies || []);

      if (dataComp.companies && dataComp.companies.length > 0 && !empresaAtivaId) {
        setEmpresaAtivaId(dataComp.companies[0].id);
      }

      // 3. Materiais
      const resMat = await fetch('/api/inventory');
      const dataMat = await resMat.json();
      setMateriais(dataMat.materials || []);

      // 4. Solicitações
      const resReq = await fetch('/api/requests');
      const dataReq = await resReq.json();
      setSolicitacoes(dataReq.requests || []);

      // 5. Riscos
      const resRisk = await fetch('/api/risks');
      const dataRisk = await resRisk.json();
      setAnalisesRiscos(dataRisk.analyses || []);

      // 6. Auditoria em Tempo Real
      const resAudit = await fetch('/api/audit');
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

  const TABS = [
    { id: "empresas", label: "Empresas", icon: "business", isFree: true },
    { id: "reconhecimento", label: "Análise de Riscos", icon: "security", isFree: false },
    { id: "almoxarifado", label: "Almoxarifado & Estoque", icon: "inventory_2", isFree: false },
    { id: "solicitacoes", label: "Solicitações & Baixas", icon: "assignment_turned_in", isFree: true, badge: contagemPendentes },
    { id: "auditoria", label: "Auditoria em Tempo Real", icon: "history_toggle_off", isFree: true },
    { id: "pagamento", label: "Assinatura PRO", icon: "workspace_premium", isFree: true, highlight: !isPremium },
  ];

  // Logout
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
    localStorage.removeItem('sst_pro_user');
    setCurrentUser(null);
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
      {/* BARRA LATERAL (Sidebar) */}
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="sidebar-brand-icon">
            <Icon name="health_and_safety" style={{ fontSize: '24px' }} />
          </div>
          <div>
            <h1 style={{ fontSize: '17px', fontWeight: 800, color: '#0f172a', letterSpacing: '-0.3px' }}>SST PRO</h1>
            <a href="https://sstpro.com.br" target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#2563eb', fontWeight: 600, textDecoration: 'none' }}>
              https://sstpro.com.br
            </a>
          </div>
        </div>

        <div className="sidebar-nav">
          <div className="nav-section-title">Menu Principal</div>
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <Icon name={t.icon} style={{ fontSize: '20px' }} />
              <span style={{ flex: 1 }}>{t.label}</span>

              {t.badge > 0 && (
                <span className="nav-counter alert" title={`${t.badge} solicitações pendentes`}>
                  {t.badge}
                </span>
              )}

              {!t.isFree && !isPremium && (
                <Icon name="lock" style={{ fontSize: '15px', color: '#94a3b8' }} />
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
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                {currentUser.registration_number || 'Técnico Responsável'}
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
        {/* TOPBAR */}
        <div className="topbar">
          <div className="topbar-left">
            {empresas.length > 0 && !["empresas", "pagamento", "auditoria"].includes(tab) ? (
              <div className="company-selector-box">
                <Icon name="domain" style={{ color: '#2563eb', fontSize: '18px' }} />
                <span style={{ fontSize: '13px', fontWeight: 600, color: '#475569' }}>Empresa em Foco:</span>
                <select
                  className="select"
                  style={{ margin: 0, padding: '4px 8px', width: '280px', background: '#fff', border: '1px solid #cbd5e1' }}
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
                  Banco SQLite Local Conectado • {empresas.length} Empresas
                </span>
              </div>
            )}
          </div>

          <div className="topbar-right">
            {/* Badge de Plano */}
            <div 
              className={`badge ${isPremium ? 'badge-pro' : 'badge-free'}`}
              style={{ cursor: 'pointer' }}
              onClick={() => setTab("pagamento")}
            >
              {isPremium ? (
                <React.Fragment>
                  <Icon name="workspace_premium" style={{ fontSize: '16px', color: '#fbbf24' }} />
                  <span>PLANO PRO ATIVO</span>
                </React.Fragment>
              ) : (
                <React.Fragment>
                  <Icon name="lock" style={{ fontSize: '14px' }} />
                  <span>Plano Gratuito • Upgrade</span>
                </React.Fragment>
              )}
            </div>
          </div>
        </div>

        {/* CONTEÚDO DA ABA SELECIONADA */}
        <div className="content-wrapper">
          <div className="container">
            {/* Se aba for restrita e não for PRO */}
            {!TABS.find((t) => t.id === tab)?.isFree && !isPremium ? (
              <div className="lock-overlay">
                <div style={{ width: '70px', height: '70px', borderRadius: '50%', background: '#fee2e2', color: '#ef4444', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px auto' }}>
                  <Icon name="lock" style={{ fontSize: '36px' }} />
                </div>
                <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>Recurso Exclusivo do Plano PRO</h2>
                <p style={{ color: '#64748b', marginBottom: '28px', fontSize: '15px', lineHeight: '1.6', maxWidth: '500px', margin: '0 auto 28px auto' }}>
                  A gestão de almoxarifado completo com baixa automática de estoque, aprovação de EPIs com termo assinado e relatórios fotográficos de campo exigem a assinatura PRO.
                </p>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
                  <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 28px' }} onClick={() => setTab("pagamento")}>
                    <Icon name="workspace_premium" /> Conhecer Planos e Assinar
                  </button>
                </div>
              </div>
            ) : (
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
                    isPremium={isPremium}
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

                {tab === "pagamento" && (
                  <TabPagamento
                    isPremium={isPremium}
                    subscriptionInfo={subscriptionInfo}
                    currentUser={currentUser}
                    geoCoords={geoCoords}
                    onRefresh={loadAllData}
                    onOpenReceipt={(rec) => setReciboPagamentoData(rec)}
                    showToast={showToast}
                  />
                )}
              </React.Fragment>
            )}
          </div>
        </div>
      </div>

      {/* MODAL: TERMO DE ENTREGA E BAIXA DE EPI */}
      {termoModalData && (
        <TermoEntregaModal
          request={termoModalData}
          onClose={() => setTermoModalData(null)}
        />
      )}

      {/* MODAL: COMPROVANTE DE PAGAMENTO PRO */}
      {reciboPagamentoData && (
        <ReciboPagamentoModal
          receipt={reciboPagamentoData}
          onClose={() => setReciboPagamentoData(null)}
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
// TELA DE LOGIN PARA O TÉCNICO RESPONSÁVEL
// =========================================================================
function LoginScreen({ onLoginSuccess, geoCoords, showToast }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("1234");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = async (e) => {
    if (e) e.preventDefault();
    if (!username || !password) {
      setErrorMsg("Preencha o usuário e a senha.");
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

  const ACCOUNTS = [
    { user: 'admin', label: 'Admin Principal', role: 'Responsável Técnico' },
    { user: 'Eric', label: 'Eric', role: 'Técnico SST' },
    { user: 'Samuel', label: 'Samuel', role: 'Técnico SST' },
    { user: 'Victor', label: 'Victor', role: 'Técnico SST' }
  ];

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
          <p className="login-subtitle">Acesso ao Sistema de Segurança do Trabalho</p>
        </div>

        {/* Seleção rápida de usuários cadastrados */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '12px', marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            <Icon name="group" style={{ color: '#2563eb', fontSize: '16px' }} />
            <span>Selecione o Usuário para Acessar:</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {ACCOUNTS.map(acc => {
              const isSelected = username.toLowerCase() === acc.user.toLowerCase();
              return (
                <button
                  key={acc.user}
                  type="button"
                  onClick={() => { setUsername(acc.user); setPassword("1234"); setErrorMsg(""); }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: isSelected ? '1.5px solid #2563eb' : '1px solid #cbd5e1',
                    background: isSelected ? '#eff6ff' : '#ffffff',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    background: isSelected ? '#2563eb' : '#64748b',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '11px',
                    fontWeight: 700
                  }}>
                    {acc.user.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc.label}</div>
                    <div style={{ fontSize: '10px', color: '#64748b' }}>{acc.role}</div>
                  </div>
                </button>
              );
            })}
          </div>
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
// ABA 2: ANÁLISE DE RISCOS COM FOTOS
// =========================================================================
function TabReconhecimento({ empresaAtiva, analises, currentUser, geoCoords, onRefresh, showToast }) {
  const [local, setLocal] = useState("");
  const [setor, setSetor] = useState("");
  const [tipoRisco, setTipoRisco] = useState("Físico");
  const [nivelRisco, setNivelRisco] = useState("Médio");
  const [riscos, setRiscos] = useState("");
  const [medidas, setMedidas] = useState("");
  const [foto, setFoto] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);

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
    if (!local.trim() || !riscos.trim()) {
      return showToast("Preencha o local inspecionado e a descrição dos riscos.", "error");
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
          tipoRisco,
          nivelRisco,
          riscos: riscos.trim(),
          medidasPreventivas: medidas.trim(),
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

      showToast("Relatório de inspeção de risco registrado no SQLite com sucesso!", "success");
      setLocal(""); setSetor(""); setRiscos(""); setMedidas(""); setFoto(null);
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
      {/* Formulário de Registro de Riscos */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="security" style={{ color: '#2563eb' }} />
            <span>Nova Inspeção de Campo</span>
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

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <label className="label">Categoria do Risco</label>
              <select className="select" value={tipoRisco} onChange={(e) => setTipoRisco(e.target.value)}>
                <option value="Físico">Físico (Ruído/Calor/Vibração)</option>
                <option value="Químico">Químico (Poeira/Vapores)</option>
                <option value="Biológico">Biológico (Bactérias/Vírus)</option>
                <option value="Ergonômico">Ergonômico (Postura/Peso)</option>
                <option value="Acidente / Altura">Acidente / Altura / Elétrico</option>
              </select>
            </div>

            <div>
              <label className="label">Nível de Severidade</label>
              <select className="select" value={nivelRisco} onChange={(e) => setNivelRisco(e.target.value)}>
                <option value="Baixo">Baixo (Tolerável)</option>
                <option value="Médio">Médio (Atenção)</option>
                <option value="Alto">Alto (Grave)</option>
                <option value="Crítico">Crítico (Iminente)</option>
              </select>
            </div>
          </div>

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
                  Clique para tirar foto ou selecionar imagem
                </span>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Gravado diretamente no banco SQLite local</span>
              </React.Fragment>
            )}
          </div>

          <label className="label">Descrição Detalhada do Risco Identificado *</label>
          <textarea
            className="textarea"
            style={{ height: '90px', resize: 'vertical' }}
            value={riscos}
            onChange={(e) => setRiscos(e.target.value)}
            placeholder="Descreva as não-conformidades, condições perigosas e riscos à integridade do trabalhador..."
            required
          />

          <label className="label">Medidas de Controle / Ações Preventivas Recomendadas</label>
          <textarea
            className="textarea"
            style={{ height: '70px', resize: 'vertical' }}
            value={medidas}
            onChange={(e) => setMedidas(e.target.value)}
            placeholder="EPIs necessários, adequação de proteção coletiva (EPC), treinamento NR..."
          />

          <button type="submit" className="btn btn-primary" disabled={loading}>
            <Icon name="save" /> Registrar Relatório de Inspeção
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
                      <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                        <span className={`badge ${a.nivel_risco === 'Crítico' || a.nivel_risco === 'Alto' ? 'badge-danger' : a.nivel_risco === 'Médio' ? 'badge-warning' : 'badge-success'}`}>
                          Nível {a.nivel_risco}
                        </span>
                        <span className="badge badge-free">{a.tipo_risco}</span>
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
// ABA 4: SOLICITAÇÕES COM BAIXA AUTOMÁTICA DE EPI NO ALMOXARIFADO
// =========================================================================
function TabSolicitacoes({ empresaAtiva, materiaisAtivos, solicitacoes, isPremium, currentUser, geoCoords, onRefresh, onOpenTermo, showToast }) {
  const [colaborador, setColaborador] = useState("");
  const [funcao, setFuncao] = useState("Colaborador Operacional");
  const [matId, setMatId] = useState("");
  const [quantidade, setQuantidade] = useState("1");
  const [motivo, setMotivo] = useState("Substituição Periódica");
  const [loading, setLoading] = useState(false);

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
    if (!colaborador.trim() || !matId) {
      return showToast("Preencha o nome do colaborador e selecione o EPI no estoque.", "error");
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
          materialId: matId,
          quantidade: Number(quantidade) || 1,
          motivo,
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast(`Solicitação de EPI para '${colaborador}' gerada com sucesso!`, "success");
      setColaborador(""); setMatId(""); setQuantidade("1");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  // FUNÇÃO CRUCIAL: BAIXA AUTOMÁTICA NO ESTOQUE AO APROVAR
  const handleAprovarEBaixarEstoque = async (req) => {
    if (!confirm(`Confirmar entrega de ${req.quantidade}x '${req.material_nome}' para o colaborador '${req.colaborador}'?\n\nIsso dará BAIXA AUTOMÁTICA imediata no estoque do almoxarifado sob responsabilidade de ${currentUser.name}.`)) {
      return;
    }

    try {
      const res = await fetch(`/api/requests/${req.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          technicianId: currentUser.id,
          technicianName: currentUser.name,
          technicianRegistration: currentUser.registration_number,
          observacoes: `Entrega técnica realizada e conferida. EPI com CA ${req.ca_number || 'regular'} entregue em perfeitas condições de uso conforme NR-06.`,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Disparar confetti visual de celebração da entrega
      if (window.confetti) {
        window.confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 } });
      }

      showToast(data.message, "success");
      onRefresh();

      // Abrir o Termo de Entrega oficial para conferência e impressão
      onOpenTermo(data.request);
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div className="grid-layout">
      {/* Formulário de Pedido de EPI */}
      <div className="card">
        <div className="card-header">
          <div className="card-title-group">
            <Icon name="front_hand" style={{ color: '#2563eb' }} />
            <span>Gerar Nova Solicitação de EPI</span>
          </div>
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

          <label className="label">EPI Solicitado (Estoque Atual no Almoxarifado) *</label>
          <select className="select" value={matId} onChange={(e) => setMatId(e.target.value)} required>
            <option value="">Selecione no almoxarifado...</option>
            {materiaisAtivos.map((m) => (
              <option key={m.id} value={m.id} disabled={m.quantidade_disponivel <= 0}>
                {m.identificacao} ({m.ca_number || 'S/ CA'}) — Saldo: {m.quantidade_disponivel} {m.unidade} {m.quantidade_disponivel <= 0 ? '(ESGOTADO)' : ''}
              </option>
            ))}
          </select>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '12px' }}>
            <div>
              <label className="label">Quantidade *</label>
              <input
                className="input"
                type="number"
                min="1"
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="label">Motivo da Entrega</label>
              <select className="select" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
                <option value="Admissão de Colaborador">Admissão de Colaborador</option>
                <option value="Substituição por Desgaste">Substituição por Desgaste</option>
                <option value="Perda / Extravio">Perda / Extravio</option>
                <option value="Início de Atividade Especial / Altura">Início de Atividade Especial</option>
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '8px' }}>
            <Icon name="assignment" /> Gerar Pedido de EPI
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
// ABA 6: ASSINATURA PRO COM CHECKOUT MULTI-MÉTODOS (PIX, CARTÃO, BOLETO)
// =========================================================================
function TabPagamento({ isPremium, subscriptionInfo, currentUser, geoCoords, onRefresh, onOpenReceipt, showToast }) {
  const [selectedMethod, setSelectedMethod] = useState("pix");
  const [loading, setLoading] = useState(false);

  // Estados dos formulários de pagamento
  // 1. Cartão de Crédito / Débito
  const [cardNumber, setCardNumber] = useState("4532 •••• •••• 8890");
  const [cardHolder, setCardHolder] = useState(currentUser?.name || "TÉCNICO RESPONSÁVEL SST");
  const [cardExpiry, setCardExpiry] = useState("12/28");
  const [cardCvv, setCardCvv] = useState("890");

  // 2. PIX Oficial com QR Code Real
  const [pixData, setPixData] = useState({
    pixCode: "00020126430014br.gov.bcb.pix0121contato@sstpro.com.br5204000053039865406149.905802BR5916SST PRO SISTEMAS6009SAO PAULO62130509SSTPRO1496304E8A2",
    qrCodeDataUrl: "",
    merchantName: "SST PRO SISTEMAS",
    merchantCity: "SAO PAULO",
    pixKey: "contato@sstpro.com.br",
    amount: 149.90
  });
  const [copiedPix, setCopiedPix] = useState(false);
  const [isEditingPix, setIsEditingPix] = useState(false);
  const [editPixKey, setEditPixKey] = useState("contato@sstpro.com.br");
  const [editKeyType, setEditKeyType] = useState("email");
  const [editMerchantName, setEditMerchantName] = useState("SST PRO SISTEMAS");
  const [editMerchantCity, setEditMerchantCity] = useState("SAO PAULO");
  const [savingPix, setSavingPix] = useState(false);

  // Carregar dados reais do PIX
  const loadPixData = async () => {
    try {
      const res = await fetch('/api/pix/data');
      if (res.ok) {
        const data = await res.json();
        setPixData(data);
        if (data.config) {
          setEditPixKey(data.config.pix_key || "contato@sstpro.com.br");
          setEditKeyType(data.config.key_type || "email");
          setEditMerchantName(data.config.merchant_name || "SST PRO SISTEMAS");
          setEditMerchantCity(data.config.merchant_city || "SAO PAULO");
        }
      }
    } catch (err) {
      console.error("Erro ao carregar dados do PIX:", err);
    }
  };

  useEffect(() => {
    loadPixData();
  }, []);

  const handleSalvarChavePix = async (e) => {
    if (e) e.preventDefault();
    if (!editPixKey.trim()) return showToast("Informe uma chave PIX válida.", "error");

    setSavingPix(true);
    try {
      const res = await fetch('/api/pix/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pixKey: editPixKey.trim(),
          keyType: editKeyType,
          merchantName: editMerchantName.trim(),
          merchantCity: editMerchantCity.trim(),
          amount: 149.90,
          txId: 'SSTPRO149',
          userId: currentUser?.id,
          username: currentUser?.name
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setPixData((prev) => ({
        ...prev,
        pixCode: data.pixCode,
        qrCodeDataUrl: data.qrCodeDataUrl,
        merchantName: data.config.merchant_name,
        merchantCity: data.config.merchant_city,
        pixKey: data.config.pix_key
      }));

      setIsEditingPix(false);
      showToast("Chave PIX atualizada! O QR Code oficial e o código Copia e Cola foram recalculados.", "success");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSavingPix(false);
    }
  };

  // 3. Boleto
  const linhaDigitavel = "34191.79001 01043.510047 91020.150008 5 98450000014900";

  const handleCopyPix = () => {
    navigator.clipboard.writeText(pixData.pixCode);
    setCopiedPix(true);
    showToast("Código PIX Copia e Cola copiado com sucesso!", "success");
    setTimeout(() => setCopiedPix(false), 3000);
  };

  const handleProcessarPagamento = async (methodOverride) => {
    const method = methodOverride || selectedMethod;
    setLoading(true);

    try {
      const res = await fetch('/api/payment/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: method,
          amount: 149.90,
          paymentDetails: {
            cardNumberLast4: cardNumber.slice(-4),
            cardHolder,
            modalidade: 'renovacao_mensal_recorrente'
          },
          userId: currentUser?.id,
          username: currentUser?.name,
          latitude: geoCoords.lat,
          longitude: geoCoords.lng,
          locationText: geoCoords.text
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Efeito sonoro / Confetti de Celebração PRO
      if (window.confetti) {
        window.confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }

      showToast("🎉 Pagamento APROVADO com sucesso! Todas as funcionalidades PRO foram liberadas no banco SQLite local.", "success");
      onRefresh();
      onOpenReceipt(data.receipt);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCancelarPro = async () => {
    if (!confirm("Deseja simular o cancelamento da assinatura PRO para testar o bloqueio de telas?")) return;
    try {
      const res = await fetch('/api/payment/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUser?.id, username: currentUser?.name })
      });
      if (!res.ok) throw new Error("Erro ao cancelar.");
      showToast("Plano PRO revertido para o modo gratuito.", "info");
      onRefresh();
    } catch (err) {
      showToast(err.message, "error");
    }
  };

  return (
    <div style={{ maxWidth: '850px', margin: '0 auto' }}>
      <div className="card" style={{ borderColor: isPremium ? '#10b981' : '#2563eb', borderWidth: '2px', padding: '36px' }}>

        {/* Cabeçalho do Plano */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="workspace_premium" style={{ fontSize: '28px', color: '#2563eb' }} />
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#0f172a' }}>Assinatura SST PRO - Desktop</h2>
            </div>
            <p style={{ color: '#64748b', fontSize: '14px', marginTop: '4px' }}>
              Liberação completa de Almoxarifado, Baixa Automática de Estoque, Relatórios Fotográficos e Termos de Entrega.
            </p>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '36px', fontWeight: 800, color: '#0f172a' }}>
              R$ 149,90 <span style={{ fontSize: '15px', color: '#64748b', fontWeight: 400 }}>/mês</span>
            </div>
            <span className={`badge ${isPremium ? 'badge-success' : 'badge-free'}`}>
              {isPremium ? '⭐ ASSINATURA ATIVA' : 'PLANO GRATUITO'}
            </span>
          </div>
        </div>

        {/* Lista de Vantagens */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', background: '#f8fafc', padding: '20px', borderRadius: '12px', marginBottom: '28px', border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155' }}>
            <Icon name="check_circle" style={{ color: '#10b981' }} />
            <span><b>Baixa Automática</b> no Estoque de EPI</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155' }}>
            <Icon name="check_circle" style={{ color: '#10b981' }} />
            <span><b>Almoxarifado Completo</b> com CA e Saldo</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155' }}>
            <Icon name="check_circle" style={{ color: '#10b981' }} />
            <span>Inspeções de Risco com <b>Upload de Fotos</b></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155' }}>
            <Icon name="check_circle" style={{ color: '#10b981' }} />
            <span><b>Termos de Entrega de EPI</b> Digitais e Impressos</span>
          </div>
        </div>

        {/* Se já for PRO */}
        {isPremium ? (
          <div style={{ textAlign: 'center', padding: '20px', background: '#ecfdf5', borderRadius: '12px', border: '1px solid #a7f3d0' }}>
            <Icon name="verified" style={{ fontSize: '48px', color: '#10b981', marginBottom: '8px' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 700, color: '#065f46' }}>Você possui acesso PRO Total!</h3>
            <p style={{ fontSize: '13px', color: '#047857', marginTop: '4px' }}>
              Todas as telas e recursos avançados estão disponíveis no seu computador.
            </p>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '20px' }}>
              {subscriptionInfo?.receipt && (
                <button className="btn btn-outline" style={{ width: 'auto', borderColor: '#059669', color: '#059669' }} onClick={() => onOpenReceipt(subscriptionInfo.receipt)}>
                  <Icon name="receipt_long" /> Ver Comprovante de Pagamento
                </button>
              )}
              <button className="btn btn-danger" style={{ width: 'auto' }} onClick={handleCancelarPro}>
                Simular Cancelamento de Teste
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                Selecione o Meio de Pagamento para Liberação Imediata:
              </h3>
            </div>

            {/* Seletor de Meio de Pagamento */}
            <div className="payment-methods-grid">
              <div className={`payment-method-card ${selectedMethod === 'pix' ? 'selected' : ''}`} onClick={() => setSelectedMethod('pix')}>
                <Icon name="qr_code_2" style={{ fontSize: '28px', color: '#0284c7' }} />
                <div style={{ fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>PIX Instantâneo</div>
                <span style={{ fontSize: '11px', color: '#16a34a' }}>QR Code Oficial BACEN</span>
              </div>

              <div className={`payment-method-card ${selectedMethod === 'credit_card' ? 'selected' : ''}`} onClick={() => setSelectedMethod('credit_card')}>
                <Icon name="credit_card" style={{ fontSize: '28px', color: '#2563eb' }} />
                <div style={{ fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>Cartão de Crédito</div>
                <span style={{ fontSize: '11px', color: '#16a34a' }}>Renovação Mensal</span>
              </div>

              <div className={`payment-method-card ${selectedMethod === 'debit_card' ? 'selected' : ''}`} onClick={() => setSelectedMethod('debit_card')}>
                <Icon name="account_balance_wallet" style={{ fontSize: '28px', color: '#059669' }} />
                <div style={{ fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>Cartão de Débito</div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Débito em conta</span>
              </div>

              <div className={`payment-method-card ${selectedMethod === 'boleto' ? 'selected' : ''}`} onClick={() => setSelectedMethod('boleto')}>
                <Icon name="receipt" style={{ fontSize: '28px', color: '#475569' }} />
                <div style={{ fontWeight: 700, fontSize: '13px', marginTop: '6px' }}>Boleto Bancário</div>
                <span style={{ fontSize: '11px', color: '#64748b' }}>Compensação rápida</span>
              </div>
            </div>

            {/* 1. FLUXO PIX REAL */}
            {selectedMethod === 'pix' && (
              <div className="pix-qr-container">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a' }}>
                    Pagamento via PIX Real (Padrão BACEN BR Code)
                  </h4>
                  <button 
                    className="btn btn-outline" 
                    style={{ padding: '6px 12px', fontSize: '12px', width: 'auto' }}
                    onClick={() => setIsEditingPix(!isEditingPix)}
                  >
                    <Icon name="settings" style={{ fontSize: '14px' }} />
                    {isEditingPix ? "Fechar Configuração" : "Configurar Minha Chave PIX"}
                  </button>
                </div>

                {/* Painel de Configuração da Chave PIX */}
                {isEditingPix && (
                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: '12px', padding: '16px', margin: '12px 0 20px 0', textAlign: 'left' }}>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#0f172a', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Icon name="vpn_key" style={{ color: '#2563eb', fontSize: '18px' }} />
                      Configurar Chave PIX de Recebimento
                    </div>
                    <form onSubmit={handleSalvarChavePix}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '10px', marginBottom: '10px' }}>
                        <div>
                          <label className="label" style={{ fontSize: '12px' }}>Tipo de Chave</label>
                          <select className="select" style={{ padding: '8px' }} value={editKeyType} onChange={(e) => setEditKeyType(e.target.value)}>
                            <option value="cpf">CPF</option>
                            <option value="cnpj">CNPJ</option>
                            <option value="email">E-mail</option>
                            <option value="telefone">Celular / Telefone</option>
                            <option value="aleatoria">Chave Aleatória (EVP)</option>
                          </select>
                        </div>
                        <div>
                          <label className="label" style={{ fontSize: '12px' }}>Chave PIX *</label>
                          <input
                            className="input"
                            style={{ padding: '8px' }}
                            value={editPixKey}
                            onChange={(e) => setEditPixKey(e.target.value)}
                            placeholder="Insira seu CPF, CNPJ, E-mail ou Chave Aleatória"
                            required
                          />
                        </div>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '10px', marginBottom: '12px' }}>
                        <div>
                          <label className="label" style={{ fontSize: '12px' }}>Nome do Beneficiário (Titular)</label>
                          <input
                            className="input"
                            style={{ padding: '8px' }}
                            value={editMerchantName}
                            onChange={(e) => setEditMerchantName(e.target.value)}
                            placeholder="Nome Completo ou Razão Social"
                          />
                        </div>
                        <div>
                          <label className="label" style={{ fontSize: '12px' }}>Cidade</label>
                          <input
                            className="input"
                            style={{ padding: '8px' }}
                            value={editMerchantCity}
                            onChange={(e) => setEditMerchantCity(e.target.value)}
                            placeholder="Ex: SAO PAULO"
                          />
                        </div>
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                        <button type="button" className="btn btn-outline" style={{ width: 'auto', padding: '6px 14px' }} onClick={() => setIsEditingPix(false)}>
                          Cancelar
                        </button>
                        <button type="submit" className="btn btn-primary" style={{ width: 'auto', padding: '6px 18px' }} disabled={savingPix}>
                          <Icon name="check" /> {savingPix ? "Atualizando..." : "Salvar e Gerar Novo QR Code"}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
                  Abra o aplicativo de qualquer banco (Nubank, Itaú, Bradesco, Inter, Mercado Pago, etc.) e escaneie o QR Code oficial abaixo ou copie o código Copia e Cola:
                </p>

                {/* Detalhes do Beneficiário */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', fontSize: '12px', color: '#475569', background: '#f1f5f9', padding: '8px 16px', borderRadius: '8px', marginBottom: '16px' }}>
                  <span>Beneficiário: <strong>{pixData.merchantName}</strong></span>
                  <span>Valor: <strong>R$ 149,90</strong></span>
                  <span>Cidade: <strong>{pixData.merchantCity}</strong></span>
                </div>

                {/* QR Code REAL PNG Gerado em Alta Resolução */}
                <div style={{ background: '#fff', padding: '16px', display: 'inline-block', border: '1px solid #cbd5e1', borderRadius: '16px', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}>
                  {pixData.qrCodeDataUrl ? (
                    <img 
                      src={pixData.qrCodeDataUrl} 
                      alt="QR Code PIX Oficial BACEN" 
                      style={{ width: '220px', height: '220px', display: 'block', margin: '0 auto' }} 
                    />
                  ) : (
                    <div style={{ width: '220px', height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <Icon name="sync" style={{ animation: 'spin 1s linear infinite', fontSize: '32px', color: '#2563eb' }} />
                    </div>
                  )}
                </div>

                <div className="pix-code-box" style={{ wordBreak: 'break-all', fontSize: '12px', fontFamily: 'monospace' }}>
                  {pixData.pixCode}
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button className="btn btn-outline" style={{ width: 'auto' }} onClick={handleCopyPix}>
                    <Icon name={copiedPix ? "check" : "content_copy"} />
                    {copiedPix ? "Chave Copiada!" : "Copiar Código Pix"}
                  </button>

                  <button className="btn btn-success" style={{ width: 'auto', padding: '12px 28px' }} onClick={() => handleProcessarPagamento('pix')} disabled={loading}>
                    <Icon name="bolt" /> Simular Pagamento Confirmado (PIX)
                  </button>
                </div>
              </div>
            )}

            {/* 2. FLUXO CARTÃO DE CRÉDITO OU DÉBITO */}
            {(selectedMethod === 'credit_card' || selectedMethod === 'debit_card') && (
              <div>
                {/* Visual do Cartão */}
                <div className="credit-card-preview">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                    <Icon name="credit_card" style={{ fontSize: '32px' }} />
                    <span style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '1px' }}>
                      {selectedMethod === 'credit_card' ? 'CRÉDITO' : 'DÉBITO'} PRO
                    </span>
                  </div>

                  <div style={{ fontSize: '20px', letterSpacing: '3px', fontFamily: 'monospace', marginBottom: '20px' }}>
                    {cardNumber || '•••• •••• •••• ••••'}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                    <div>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94a3b8' }}>Titular</div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{cardHolder || 'NOME DO TITULAR'}</div>
                    </div>

                    <div>
                      <div style={{ fontSize: '10px', textTransform: 'uppercase', color: '#94a3b8' }}>Validade</div>
                      <div style={{ fontSize: '13px', fontWeight: 600 }}>{cardExpiry || 'MM/AA'}</div>
                    </div>
                  </div>
                </div>

                {/* Formulário do Cartão */}
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="label">Número do Cartão</label>
                    <input
                      className="input"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="4532 0000 0000 0000"
                    />
                  </div>

                  <div>
                    <label className="label">CVV / Cód. Segurança</label>
                    <input
                      className="input"
                      value={cardCvv}
                      onChange={(e) => setCardCvv(e.target.value)}
                      placeholder="123"
                      maxLength="4"
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="label">Nome Impresso no Cartão</label>
                    <input
                      className="input"
                      value={cardHolder}
                      onChange={(e) => setCardHolder(e.target.value)}
                      placeholder="Nome do titular"
                    />
                  </div>

                  <div>
                    <label className="label">Validade</label>
                    <input
                      className="input"
                      value={cardExpiry}
                      onChange={(e) => setCardExpiry(e.target.value)}
                      placeholder="MM/AA"
                    />
                  </div>
                </div>

                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: '12px 16px', borderRadius: '10px', margin: '8px 0 16px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <Icon name="autorenew" style={{ color: '#2563eb', fontSize: '22px' }} />
                  <div style={{ fontSize: '13px', color: '#1e40af' }}>
                    <strong>Modalidade: Assinatura Mensal Recorrente</strong><br />
                    Valor único de <strong>R$ 149,90/mês</strong> debitado mensalmente no cartão (sem parcelamento).
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  style={{ padding: '14px', fontSize: '15px' }}
                  onClick={() => handleProcessarPagamento(selectedMethod)}
                  disabled={loading}
                >
                  <Icon name="lock" /> Confirmar Pagamento no Cartão (R$ 149,00)
                </button>
              </div>
            )}

            {/* 3. FLUXO BOLETO BANCÁRIO */}
            {selectedMethod === 'boleto' && (
              <div style={{ background: '#f8fafc', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', textAlign: 'center' }}>
                <h4 style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                  Boleto Bancário Registrado
                </h4>
                <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '16px' }}>
                  Utilize o código de barras ou a linha digitável para pagar no seu internet banking:
                </p>

                <div className="barcode-stripes"></div>

                <div className="pix-code-box">
                  {linhaDigitavel}
                </div>

                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button
                    className="btn btn-outline"
                    style={{ width: 'auto' }}
                    onClick={() => {
                      navigator.clipboard.writeText(linhaDigitavel);
                      showToast("Linha digitável copiada!", "success");
                    }}
                  >
                    <Icon name="content_copy" /> Copiar Linha Digitável
                  </button>

                  <button
                    className="btn btn-primary"
                    style={{ width: 'auto', padding: '12px 28px' }}
                    onClick={() => handleProcessarPagamento('boleto')}
                    disabled={loading}
                  >
                    <Icon name="check_circle" /> Simular Pagamento do Boleto
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =========================================================================
// MODAL: TERMO OFICIAL DE ENTREGA E BAIXA DE EPI (NR-06)
// =========================================================================
function TermoEntregaModal({ request, onClose }) {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px', marginBottom: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Icon name="assignment_turned_in" style={{ fontSize: '28px', color: '#10b981' }} />
            <div>
              <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#0f172a' }}>Termo de Entrega e Responsabilidade de EPI</h3>
              <span style={{ fontSize: '12px', color: '#64748b' }}>Conformidade com a Norma Regulamentadora NR-06 do MTE</span>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <Icon name="close" style={{ fontSize: '24px' }} />
          </button>
        </div>

        <div style={{ background: '#f8fafc', padding: '18px', borderRadius: '12px', border: '1px solid #e2e8f0', marginBottom: '20px', fontSize: '13px', lineHeight: '1.6', color: '#334155' }}>
          <p style={{ marginBottom: '10px' }}>
            Declaro ter recebido da empresa o Equipamento de Proteção Individual (EPI) abaixo discriminado, em perfeito estado de conservação e funcionamento, com o respectivo Certificado de Aprovação (CA) válido, comprometendo-me a utilizá-lo estritamente para a finalidade a que se destina.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', background: '#fff', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', margin: '14px 0' }}>
            <div><strong>Colaborador:</strong> {request.colaborador}</div>
            <div><strong>Função:</strong> {request.funcao_colaborador || 'Colaborador'}</div>
            <div><strong>Empresa:</strong> {empresaAtiva?.name || 'Empresa Contratante'}</div>
            <div><strong>Data da Entrega:</strong> {formatDate(request.data_aprovacao || request.data_solicitacao)}</div>
          </div>

          <div style={{ background: '#eff6ff', padding: '14px', borderRadius: '8px', border: '1px solid #bfdbfe' }}>
            <div style={{ fontSize: '14px', fontWeight: 700, color: '#1e40af' }}>
              Material Entregue: {request.quantidade}x {request.material_nome}
            </div>
            <div style={{ fontSize: '12px', color: '#2563eb', marginTop: '4px' }}>
              Certificado de Aprovação: <b>{request.ca_number || 'Conforme Fabricante'}</b> | Motivo: {request.motivo}
            </div>
          </div>

          <div style={{ marginTop: '16px', fontSize: '12px', color: '#64748b' }}>
            <strong>Técnico Responsável pela Liberação:</strong> {request.aprovado_por_nome || 'Técnico SST Responsável'}<br />
            <strong>Registro Profissional:</strong> {request.aprovado_por_registro || 'MTE-SST-004521/SP'}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
          <button className="btn btn-outline" style={{ width: 'auto' }} onClick={onClose}>
            Fechar
          </button>
          <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handlePrint}>
            <Icon name="print" /> Imprimir Termo de Entrega
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// MODAL: COMPROVANTE DE PAGAMENTO PRO
// =========================================================================
function ReciboPagamentoModal({ receipt, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: '#ecfdf5', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px auto' }}>
            <Icon name="check_circle" style={{ fontSize: '36px' }} />
          </div>
          <h3 style={{ fontSize: '20px', fontWeight: 800, color: '#0f172a' }}>Comprovante Oficial de Assinatura SST PRO</h3>
          <span style={{ fontSize: '12px', color: '#64748b' }}>Transação Aprovada e Salva no Banco Local SQLite</span>
        </div>

        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', fontSize: '13px', lineHeight: '1.8', color: '#334155', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '8px' }}>
            <span>Identificador da Transação:</span>
            <strong>{receipt.transactionId}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '8px' }}>
            <span>Plano Contratado:</span>
            <strong>{receipt.planName}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '8px' }}>
            <span>Forma de Pagamento:</span>
            <strong style={{ textTransform: 'uppercase' }}>{receipt.paymentMethod}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '8px' }}>
            <span>Valor Pago:</span>
            <strong style={{ color: '#16a34a', fontSize: '16px' }}>{formatCurrency(receipt.amount)}</strong>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', paddingBottom: '8px', marginBottom: '8px' }}>
            <span>Data e Hora:</span>
            <span>{receipt.issuedAt}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Código de Autenticação:</span>
            <code style={{ fontSize: '11px', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>{receipt.authCode}</code>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
          <button className="btn btn-primary" style={{ width: 'auto', padding: '12px 32px' }} onClick={onClose}>
            Entendido, Continuar no Sistema
          </button>
        </div>
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
