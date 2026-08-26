/**
 * substanceIntel.js — Inteligência de substâncias (hormônios/anabólicos/GLP-1) do
 * Fabricio Moura, pra o conteúdo falar com AUTORIDADE REAL de cada uma.
 *
 * POR QUÊ: conteúdo de hormônio genérico não converte. O que posiciona o Fabricio
 * como autoridade é falar com conhecimento de verdade de cada substância — os ERROS
 * comuns, os PROBLEMAS/efeitos, os SINAIS DE ALERTA e os MITOS. Isso gera autoridade
 * e leva pra consultoria (acompanhamento com exame).
 *
 * LINHA DURA (anti-ban + segurança, alinhada ao cérebro editorial):
 * - Este módulo é BASE DE CONHECIMENTO pra o conteúdo EDUCAR sobre erro/risco/mecanismo.
 * - NUNCA vira dose, ml, ciclo, tempo de ciclo, empilhamento (stack), "como usar",
 *   fonte de compra ou incentivo a usar. Isso bane a conta na hora E não é o que vende.
 * - O destino de todo conteúdo é SEMPRE investigar com exame + acompanhamento profissional.
 * - Cada perfil abaixo é escrito por SINTOMA/ERRO/RISCO/MECANISMO — nunca protocolo.
 *
 * Injeta-se na instrução de hormônio do gerador diário (dailyContentService).
 */

// Cada perfil: o que é (classe/mecanismo em linguagem leiga), o erro mais comum de
// quem usa por conta, os problemas/efeitos reais, e o ângulo de conteúdo (sempre
// alerta + educação → consultoria). SEM dose, SEM protocolo, SEM "como fazer".
const SUBSTANCES = [
  {
    id: 'testosterona', nome: 'Testosterona (reposição / TRT)', classe: 'androgênio base',
    oQueE: 'o hormônio masculino base; reposição de verdade parte de exame de sangue, não de "todo mundo toma".',
    erro: 'usar sem exame e em dose de ciclo achando que é "reposição"; não monitorar sangue.',
    problemas: 'sangue mais grosso (hematócrito alto), estradiol alto (retenção, ginecomastia), acne e queda de cabelo em quem tem predisposição, encolhimento e supressão dos testículos, impacto na fertilidade.',
    angulo: 'reposição começa no exame e no acompanhamento — não em "me passa o que você usa".',
  },
  {
    id: 'deca', nome: 'Deca (nandrolona)', classe: 'anabólico de éster longo',
    oQueE: 'anabólico de ação lenta e prolongada, fama de "articulação e volume".',
    erro: 'usar sozinha, sem base androgênica, e achar que é "tranquila".',
    problemas: 'derruba libido e ereção de forma marcante (a famosa queda de libido), supressão forte e LONGA do próprio corpo, humor, retenção; por ser éster longo demora a agir e demora MUITO a sair.',
    angulo: 'é a que mais mexe com libido e a que mais demora pra você voltar ao normal.',
  },
  {
    id: 'primobolan', nome: 'Primobolan (metenolona)', classe: 'anabólico "leve" caro',
    oQueE: 'anabólico androgênico fraco, com fama de "hormônio de elite/estético".',
    erro: 'pagar caro esperando milagre — e comprar falsificado.',
    problemas: 'é DAS mais falsificadas do mercado: boa parte do que se vende como Primobolan é outra coisa na ampola. O maior risco não é nem o hormônio, é não saber o que você está aplicando.',
    angulo: 'o "hormônio de elite" é também o mais fraudado — você paga caro e nem sabe o que veio.',
  },
  {
    id: 'retatrutida', nome: 'Retatrutida', classe: 'GLP-1/GIP/glucagon (emagrecedor) EXPERIMENTAL',
    oQueE: 'a nova geração de emagrecedor injetável — ainda EM ESTUDO, sem aprovação ampla.',
    erro: 'comprar de fonte não confiável achando que é "só emagrecer mais forte".',
    problemas: 'ainda não tem resposta de longo prazo (segurança/manutenção); como não há versão farmacêutica aprovada disponível, o que circula pode ser manipulado sem controle. Mesmos riscos de GLP-1 (perda de massa magra, efeitos gastrointestinais), potencialmente amplificados.',
    angulo: 'a promessa mais nova é também a que menos tem resposta de longo prazo — cautela.',
  },
  {
    id: 'mounjaro', nome: 'Mounjaro (tirzepatida)', classe: 'GLP-1/GIP (emagrecedor) aprovado',
    oQueE: 'emagrecedor injetável que corta o apetite; funciona pra perder peso.',
    erro: 'usar sozinho, sem treino e sem proteína suficiente — e parar sem plano.',
    problemas: 'emagrece rápido mas leva MÚSCULO junto (vira magro mole/flácido), efeito rebote quando para sem estratégia, enjoo/gastrointestinal quando sobe rápido demais.',
    angulo: 'emagrece de verdade, mas sem estratégia cobra o teu músculo e o peso volta.',
  },
  {
    id: 'stanozolol', nome: 'Stanozolol (Winstrol)', classe: 'anabólico "secador"',
    oQueE: 'anabólico com fama de "secar/definir" — mais estética enganosa que gordura real.',
    erro: 'usar achando que "seca gordura" e ignorar o preço que o corpo paga.',
    problemas: 'arrasa o colesterol bom (HDL) e sobrecarrega o coração, resseca e machuca articulações e tendões (risco real de lesão/ruptura), tóxico pro fígado na forma oral, queda de cabelo, humor.',
    angulo: 'o "secador" que arrebenta articulação, colesterol e coração enquanto te ilude no espelho.',
  },
  {
    id: 'oxandrolona', nome: 'Oxandrolona (Anavar)', classe: 'anabólico com fama de "leve"',
    oQueE: 'anabólico oral vendido como "leve e seguro" — o que é um mito.',
    erro: 'confiar na fama de "inofensiva" e (em mulheres) ignorar o risco de virilização.',
    problemas: 'derruba o HDL com força, é tóxica pro fígado, SIM suprime o eixo, e em mulheres pode causar virilização IRREVERSÍVEL (voz grave, alterações). É também das mais falsificadas — muitas vezes é stanozolol/outro vendido como oxandrolona.',
    angulo: 'a "leve" que não é leve — e uma das mais falsificadas do mercado.',
  },
  {
    id: 'trembolona', nome: 'Trembolona', classe: 'anabólico potente',
    oQueE: 'um dos anabólicos mais potentes — e mais pesados nos efeitos.',
    erro: 'ser atraído pela potência e subestimar o estrago sistêmico.',
    problemas: 'destrói sono e humor (irritabilidade, ansiedade, "tren"), sufoca o cardio, mexe forte com libido e com os rins, suor noturno; um dos que mais tiram qualidade de vida.',
    angulo: 'a mais potente é também a que mais rouba teu sono, teu humor e teu fôlego.',
  },
  {
    id: 'gh-insulina', nome: 'GH e insulina', classe: 'hormônios de crescimento/metabólicos',
    oQueE: 'os hormônios que rodeiam o meio "avançado" — e os mais perigosos por erro.',
    erro: 'tratar como mágica; a insulina por conta é a mais letal de todas.',
    problemas: 'insulina mal usada causa hipoglicemia que PODE MATAR em minutos; GH é caro, muito falsificado, e sem controle traz resistência à insulina, retenção, síndrome do túnel do carpo e crescimento de órgãos/abdômen. Nada de "atalho" — é onde o erro mais custa caro.',
    angulo: 'são os que menos perdoam erro — insulina por conta mata, GH sem controle cobra o resto.',
  },
];

// Bloco compacto pra injeção no prompt: conhecimento por substância + guarda-corpo.
// O modelo usa isso pra ESCREVER com propriedade (erro/risco/mecanismo), NUNCA pra
// prescrever. O guarda-corpo vem ANTES e DEPOIS pra não escorregar.
const SUBSTANCE_INTEL = [
  '',
  '━━━ INTELIGÊNCIA DE SUBSTÂNCIAS (use pra ter AUTORIDADE REAL — NUNCA pra prescrever) ━━━',
  'Você conhece a fundo as substâncias abaixo e fala dos ERROS, RISCOS, PROBLEMAS, MITOS e MECANISMOS de cada uma — como um treinador experiente que já viu gente errar, alertando. Isso é o que gera autoridade e leva pra consultoria.',
  'LINHA DURA (INEGOCIÁVEL, senão bane a conta E não converte):',
  '• NUNCA dose, mg, ml, ciclo, tempo de ciclo, empilhamento/stack, "como usar/aplicar/tomar", onde comprar ou fonte. Nem incentivo a usar. Nem promessa de resultado.',
  '• SEMPRE por SINTOMA / ERRO / RISCO / SINAL DE ALERTA / MECANISMO. O destino é SEMPRE investigar com exame + acompanhamento profissional — nunca fazer por conta.',
  '• Pode NOMEAR a substância pra educar sobre o risco/erro dela; NÃO pode tratá-la como produto a ser vendido/indicado.',
  'PERFIS (o que a IA sabe de cada uma):',
  ...SUBSTANCES.map((s) =>
    `• ${s.nome} — ${s.classe}. É: ${s.oQueE} Erro comum: ${s.erro} Problemas/efeitos: ${s.problemas} Ângulo: ${s.angulo}`),
  'REGRA FINAL: se um slide ensinar a usar, der dose/ciclo, ou soar como incentivo/venda de substância, REESCREVE como ALERTA educativo que manda investigar com acompanhamento. Tom: quem mostra o erro e protege — não quem entrega protocolo.',
  '',
].join('\n');

module.exports = { SUBSTANCES, SUBSTANCE_INTEL };
