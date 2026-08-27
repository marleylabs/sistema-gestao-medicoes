export type Projeto = {
  id: string;
  codigoProjeto: string;
  centroCusto: string | null;
  localizacao: string | null;
  contrato: string | null;
};

export type Profissional = {
  id: string;
  nome: string;
  codigo: string | null;
  nomeCompleto: string | null;
  cpf: string | null;
  razaoSocial: string | null;
  cnpj: string | null;
  email: string | null;
  statusColaborador: string | null;
  funcao: string | null;
};

export type ContratoResumo = {
  id: string;
  nome: string;
};

export type MapaPagamentoItem = {
  id: string;
  ordem: number;
  ato: string | null;
  projetistaCodigo: string | null;
  responsavel: string | null;
  cpfCnpj: string | null;
  razaoSocial: string | null;
  alocacao: string | null;
  participacaoContratos: Record<string, number>;
  documentosPendentesContrato: number;
  valorTotalDocumentosContrato: number;
  valorNaoClassificadoContrato: number;
  percentualNaoClassificadoContrato: number;
  fornecedor: {
    id: string | null;
    responsavel: string | null;
    cpfCnpj: string | null;
    razaoSocial: string | null;
    tipoCt: string | null;
  } | null;
  intrSossego: number;
  salobo: number;
  acg: number;
  escadasAlumar: number;
  horas: number;
  valor: number;
  rev: number;
  status: string | null;
  condicoesFixas?: {
    valorFixo: string | null;
    tipoContratacao: string | null;
    adicionaisFixos: string | null;
    observacoesContrato: string | null;
  };
  updatedAt: string | null;
};

export type Medicao = {
  id: string;
  numeroMedicao: string;
  idProjeto: string;
  idCoordenador: string | null;
  idProfissional: string | null;
  dataCadastro: string | null;
  formato: string | null;
  quantidade: number;
  multiplicador: number;
  equivalenteA1Horas: number;
  porcentagemRevisao: number | null;
  emissaoInicial: number | null;
  retornoVale: number | null;
  encerramento: number | null;
  arquivamento: number | null;
  medidoHoras: number;
  itemQqp: string | null;
  valorUnitario: number;
  valorBruto: number;
  valorTotal: number;
  valorReajuste: number;
  ciclo: string | null;
  referencia: string | null;
  percentualEmissao: number | null;
  tipo2: string | null;
  condicao: string | null;
  valorMedicao: number;
  obs: string | null;
  projeto: {
    codigoProjeto: string;
    centroCusto: string | null;
    contrato: string | null;
    localizacao: string | null;
  };
  coordenador: {
    nome: string;
    codigo: string | null;
    nomeCompleto: string | null;
    statusColaborador: string | null;
  } | null;
  profissional: {
    nome: string;
    codigo: string | null;
    nomeCompleto: string | null;
    cpf: string | null;
    razaoSocial: string | null;
    cnpj: string | null;
    email: string | null;
    statusColaborador: string | null;
    funcao: string | null;
  } | null;
};

export type DashboardData = {
  contextoMapa: {
    mesReferencia: string | null;
    producaoLabel: string | null;
    producaoInicio: string | null;
    producaoFim: string | null;
    atoLabel: string | null;
    atoCiclo: string | null;
    contratos: Array<{ contrato: string; valor: number }>;
    rateio: Array<{ contrato: string; percentual: number }>;
  } | null;
  cards: {
    totalMedido: number;
    totalHoras: number;
    atosAtivos: number;
    producaoAtivos: number;
    totalRegistros: number;
  };
  porCiclo: Array<{
    ciclo: string;
    periodoInicio: string;
    periodoFim: string;
    totalMedido: number;
    totalHoras: number;
    totalRegistros: number;
  }>;
  porProjeto: Array<{
    idProjeto: string;
    codigoProjeto: string;
    contrato: string | null;
    totalMedido: number;
    totalHoras: number;
    totalRegistros: number;
  }>;
  tiposPrecos: Array<{
    nome: string;
    codigo: string;
    tipo2: string;
    condicao: string;
  }>;
};
