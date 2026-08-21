// Test Suite End-to-End para SST PRO Desktop
const API_BASE = 'http://localhost:3000/api';

async function runTests() {
  console.log('====================================================');
  console.log('🧪 INICIANDO TESTES AUTOMATIZADOS E2E - SST PRO');
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
    // TESTE 1: Login com credenciais padrão (admin / 1234)
    console.log('1. Testando Autenticação e Login Inicial...');
    const loginRes = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'admin',
        password: '1234',
        latitude: -23.5505,
        longitude: -46.6333,
        locationText: 'São Paulo, SP'
      })
    });
    const loginData = await loginRes.json();
    assert(loginRes.ok && loginData.user && loginData.user.username === 'admin', 'Login do Técnico Admin com senha 1234 realizado com sucesso');

    const adminUser = loginData.user;

    // TESTE 2: Cadastro de Nova Empresa
    console.log('\n2. Testando Cadastro de Empresa no Banco SQLite Local...');
    const compRes = await fetch(`${API_BASE}/companies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Mineração & Construção Serra Dourada S/A',
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

    // TESTE 3: Cadastro de Material no Almoxarifado
    console.log('\n3. Testando Cadastro de EPI no Almoxarifado...');
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

    // TESTE 4: Solicitação de EPI para Colaborador
    console.log('\n4. Testando Geração de Solicitação de EPI...');
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

    // TESTE 5: APROVAÇÃO COM BAIXA AUTOMÁTICA DE ESTOQUE (Saldo 20 -> 17)
    console.log('\n5. Testando Aprovação do Técnico com BAIXA AUTOMÁTICA no Almoxarifado...');
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
    assert(approveRes.ok && approveData.success, 'Endpoint de aprovação retornou sucesso');
    assert(approveData.request.status === 'aprovada', 'Status da solicitação atualizado para "aprovada"');
    assert(approveData.material.quantidade_disponivel === 17, `Baixa automática realizada com sucesso: Saldo anterior 20 -> Novo saldo ${approveData.material.quantidade_disponivel} un`);

    // TESTE 6: Proteção contra Saldo Insuficiente
    console.log('\n6. Testando Proteção de Estoque Insuficiente...');
    const bigReqRes = await fetch(`${API_BASE}/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId: testCompanyId,
        colaborador: 'Colaborador Teste Limite',
        materialId: testMatId,
        quantidade: 999,
        motivo: 'Teste'
      })
    });
    const bigReqData = await bigReqRes.json();
    const failApproveRes = await fetch(`${API_BASE}/requests/${bigReqData.request.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        technicianId: adminUser.id,
        technicianName: adminUser.name
      })
    });
    const failApproveData = await failApproveRes.json();
    assert(failApproveRes.status === 400 && failApproveData.error.includes('Estoque insuficiente'), 'Tentativa de baixa além do estoque foi rejeitada com mensagem clara');

    // TESTE 7: Registro de Análise de Risco com Foto
    console.log('\n7. Testando Registro de Análise de Riscos...');
    const riskRes = await fetch(`${API_BASE}/risks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        empresaId: testCompanyId,
        local: 'Galpão de Moagem e Britagem',
        setor: 'Produção / Britagem',
        tipoRisco: 'Físico',
        nivelRisco: 'Alto',
        riscos: 'Ruído contínuo de 92 dBA e poeira mineral em suspensão.',
        medidasPreventivas: 'Uso obrigatório de protetor auricular tipo concha e máscara PFF2.',
        foto: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        registradoPor: adminUser.name,
        userId: adminUser.id,
        username: adminUser.name
      })
    });
    const riskData = await riskRes.json();
    assert(riskRes.ok && riskData.analysis && riskData.analysis.id, 'Inspeção de risco com foto gravada no SQLite local');

    // TESTE 8: Checkout Multi-Métodos (PIX, Cartão, Boleto)
    console.log('\n8. Testando Checkout Multi-Métodos e Ativação PRO...');
    for (const method of ['pix', 'credit_card', 'debit_card', 'boleto']) {
      const payRes = await fetch(`${API_BASE}/payment/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: method,
          amount: 149.00,
          userId: adminUser.id,
          username: adminUser.name
        })
      });
      const payData = await payRes.json();
      assert(payRes.ok && payData.isPremium === true && payData.receipt.transactionId, `Pagamento via [${method.toUpperCase()}] aprovado e PRO ativado no SQLite`);
    }

    // TESTE 9: Persistência de Sessão (Salvar e Restaurar onde parou)
    console.log('\n9. Testando Persistência de Onde Parou...');
    await fetch(`${API_BASE}/session/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: adminUser.id,
        currentTab: 'solicitacoes',
        currentCompanyId: testCompanyId,
        draftState: { formNote: 'Rascunho de inspeção' }
      })
    });

    const getSessionRes = await fetch(`${API_BASE}/session/${adminUser.id}`);
    const getSessionData = await getSessionRes.json();
    assert(
      getSessionData.session &&
      getSessionData.session.currentTab === 'solicitacoes' &&
      getSessionData.session.currentCompanyId === testCompanyId,
      'Ponto onde o usuário parou (Aba "Solicitações" e Empresa) salvo e restaurado com exatidão'
    );

    // TESTE 10: Auditoria e Rastreamento em Tempo Real
    console.log('\n10. Testando Feed de Auditoria e Rastreamento em Tempo Real...');
    const auditRes = await fetch(`${API_BASE}/audit?limit=50`);
    const auditData = await auditRes.json();
    const hasDeliveryAudit = auditData.logs.some(l => l.action.includes('EPI_DELIVERY'));
    const hasLoginAudit = auditData.logs.some(l => l.action.includes('LOGIN'));
    const hasPaymentAudit = auditData.logs.some(l => l.action.includes('PAYMENT'));
    assert(auditData.logs.length > 0 && hasDeliveryAudit && hasLoginAudit && hasPaymentAudit, 'Todos os eventos críticos (Logins, Baixas de EPI, Pagamentos) foram registrados na timeline de auditoria');

  } catch (err) {
    console.error('Erro na execução dos testes:', err);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`📊 RESULTADO DOS TESTES: ${passed} PASSARAM | ${failed} FALHARAM`);
  console.log('====================================================\n');

  if (failed === 0) {
    console.log('🎉 TODOS OS REQUISITOS FORAM IMPLEMENTADOS E TESTADOS COM SUCESSO!');
  } else {
    process.exit(1);
  }
}

runTests();
