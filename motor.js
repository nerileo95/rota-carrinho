/* Motor de rotas no navegador — porte de execução do motor.py.
 *
 * A geometria delicada (de que lado da rua está cada calçada, quais calçadas
 * dividem a mesma esquina) NÃO está aqui: veio pronta do Python, em `setores`.
 * Este arquivo só executa Dijkstra sobre isso.
 *
 * Estado = (trecho, ponta, lado), codificado como um inteiro:
 *     s = trecho*4 + ponta*2 + lado      ponta: 0=u, 1=v      lado: 0=E, 1=D
 */
const Motor = (() => {
  let D, K, incidentes, reports = new Map(), cal = {};

  function iniciar(dados){
    D = dados; K = dados.constantes;
    cal = { travessia: K.TRAVESSIA_M, multLargura: 3.0, multDeclive: 2.5, multIncerteza: 1.5,
            semRampa: 2.0 };
    incidentes = Array.from({length: D.nos.length}, () => []);
    D.arestas.forEach((a, i) => { incidentes[a[0]].push(i*2); incidentes[a[1]].push(i*2+1); });
    return { estados: D.arestas.length*4, nos: D.nos.length };
  }

  const noDoEstado = s => { const t=s>>2, p=(s>>1)&1; return D.arestas[t][p?1:0]; };
  const livreDoEstado = s => D.arestas[s>>2][3 + (s&1)];
  const setorDe = s => D.setores[s>>2][((s>>1)&1)*2 + (s&1)];
  const temRampa = n => D._rampa.has(n);

  /* Os limiares vêm da norma; os multiplicadores são escolha de projeto. */
  function penalidade(livre, declividade){
    if(livre === null) return cal.multIncerteza;
    let p = 1.0;
    if(livre < K.FAIXA_LIVRE_MIN_M) p *= cal.multLargura;
    if(livre < K.FAIXA_BLOQUEIO_M)  p *= cal.multLargura;
    if(declividade > K.DECLIVIDADE_MAX_PCT) p *= cal.multDeclive;
    return p;
  }

  /* As três preferências de passeio, iguais às do motor.py. */
  const PREFERENCIAS = {passeio: {}, sombra: {sombra: 0.55}, parque: {parque: 0.45}};

  function custoTrecho(s, modo){
    const t = s>>2, a = D.arestas[t], livre = a[3 + (s&1)];
    const mult = reports.get(t*2 + (s&1)) || 1.0;
    if(modo === 'comprimento') return a[2];          // metros puros, sem report
    if(modo === 'base')    return a[2] * mult;
    // sobre o custo com a penalidade da norma dentro, não sobre os metros
    // crus: senão o passeio compra sombra com calçada estreita
    const p = PREFERENCIAS[modo];
    if(p) {
      // A base continua sendo a nota inteira: "mais sombra" não é "só sombra",
      // senão a rota vira um túnel de árvores por calçada ruim.
      const extra = p.sombra || p.parque || 0;
      const comp = p.sombra ? a[8] : p.parque ? a[9] : 0;
      const n = (1 - extra) * a[6] + extra * (comp || 0);
      return a[2] * penalidade(livre, a[5]) / (0.45 + 0.85*n) * mult;
    }
    return a[2] * penalidade(livre, a[5]) * mult;      // 'cost'
  }

  /* Vizinhos calculados na hora: materializar os 128.488 arcos de transição
   * seria desperdício de memória e de tempo de carga. */
  function vizinhos(s, modo){
    const t = s>>2, ponta = (s>>1)&1, lado = s&1, saida = [];
    saida.push([t*4 + (1-ponta)*2 + lado, custoTrecho(s, modo), D.arestas[t][2]]);
    const no = noDoEstado(s), meu = setorDe(s);
    // em 'comprimento' a travessia não soma metros — é o que o Python mede
    const custoTravessia = modo === 'comprimento' ? 0
                         : cal.travessia * (temRampa(no) ? 1.0 : cal.semRampa);
    for(const ponta2 of incidentes[no]){
      const t2 = ponta2>>1, p2 = ponta2&1;
      for(let l2 = 0; l2 < 2; l2++){
        const s2 = t2*4 + p2*2 + l2;
        if(s2 === s) continue;
        saida.push([s2, setorDe(s2) === meu ? 0 : custoTravessia, 0]);
      }
    }
    return saida;
  }

  /* Fila de prioridade: sem ela, Dijkstra em 10.968 estados fica lento o
   * bastante para o usuário perceber. */
  class Heap {
    constructor(){ this.a = []; }
    get tamanho(){ return this.a.length; }
    push(prio, val){
      const a=this.a; a.push([prio,val]); let i=a.length-1;
      while(i>0){ const p=(i-1)>>1; if(a[p][0]<=a[i][0]) break; [a[p],a[i]]=[a[i],a[p]]; i=p; }
    }
    pop(){
      const a=this.a, topo=a[0], fim=a.pop();
      if(a.length){ a[0]=fim; let i=0;
        for(;;){ const e=2*i+1, d=e+1; let m=i;
          if(e<a.length && a[e][0]<a[m][0]) m=e;
          if(d<a.length && a[d][0]<a[m][0]) m=d;
          if(m===i) break; [a[m],a[i]]=[a[i],a[m]]; i=m; } }
      return topo;
    }
  }

  function dijkstra(inicios, modo, parar){
    const dist = new Float64Array(D.arestas.length*4).fill(Infinity);
    const veio = new Int32Array(D.arestas.length*4).fill(-1);
    const h = new Heap();
    for(const s of inicios){ dist[s]=0; h.push(0, s); }
    while(h.tamanho){
      const [d, s] = h.pop();
      if(d > dist[s]) continue;
      if(parar && parar(s)) return {dist, veio, alvo: s};
      for(const [s2, custo] of vizinhos(s, modo)){
        const nd = d + custo;
        if(nd < dist[s2]){ dist[s2]=nd; veio[s2]=s; h.push(nd, s2); }
      }
    }
    return {dist, veio, alvo: -1};
  }

  const estadosDoNo = n => {
    const r = [];
    for(const ponta of incidentes[n]){ const t=ponta>>1, p=ponta&1;
      r.push(t*4+p*2, t*4+p*2+1); }
    return r;
  };

  function reconstruir(veio, alvo){
    const c = []; let s = alvo;
    while(s !== -1){ c.push(s); s = veio[s]; }
    return c.reverse();
  }

  function rotear(origem, destino, modo){
    const alvos = new Set(estadosDoNo(destino));
    const {veio, alvo} = dijkstra(estadosDoNo(origem), modo, s => alvos.has(s));
    if(alvo === -1) return null;
    return reconstruir(veio, alvo);
  }

  /* Um passo do caminho é "andar" (troca de ponta no mesmo trecho) ou
   * "transição" (mesmo nó, outro trecho/lado). */
  const andou = (a, b) => (a>>2) === (b>>2) && ((a>>1)&1) !== ((b>>1)&1);

  function resumir(caminho){
    let dist=0, ruins=0, travessias=0, pior=Infinity, semRampa=0, notaSoma=0;
    for(let i=0;i<caminho.length-1;i++){
      const a=caminho[i], b=caminho[i+1];
      if(andou(a,b)){
        const t = a>>2, m = D.arestas[t][2], livre = livreDoEstado(a);
        dist += m; notaSoma += D.arestas[t][6] * m;
        if(livre !== null){ if(livre < K.FAIXA_LIVRE_MIN_M) ruins += m; pior = Math.min(pior, livre); }
      } else if(setorDe(a) !== setorDe(b)){
        travessias++;
        if(!temRampa(noDoEstado(a))) semRampa++;
      }
    }
    return {distancia_m: dist, metros_ruins: ruins, travessias, sem_rampa: semRampa,
            pct_ruim: dist ? 100*ruins/dist : 0,
            pior_livre_m: isFinite(pior) ? pior : null,
            nota: dist ? notaSoma/dist : 0,
            minutos: dist / K.PASSO_M_POR_MIN};
  }

  const cruz = (a,b) => a[0]*b[1] - a[1]*b[0];
  function deslocDe(s){
    const t=s>>2, ponta=(s>>1)&1, lado=s&1;
    const rumo = D.rumos[t][ponta];
    // olhando para fora do cruzamento, o lado E fica à esquerda na ponta inicial
    const antiHorario = (lado === 0) === (ponta === 0);
    const ang = rumo + (antiHorario ? Math.PI/2 : -Math.PI/2);
    return [Math.cos(ang), Math.sin(ang)];
  }
  /* Separa "segui em frente e cruzei a transversal" de "troquei de lado da via" —
   * coisas bem diferentes para quem empurra carrinho. */
  function mesmoLadoFisico(a, b){
    const rumo = D.rumos[b>>2][(b>>1)&1];
    const marcha = [Math.cos(rumo), Math.sin(rumo)];
    return (cruz(marcha, deslocDe(a)) > 0) === (cruz(marcha, deslocDe(b)) > 0);
  }

  function instrucoes(caminho){
    const passos = []; let via = null;
    for(let i=0;i<caminho.length-1;i++){
      const a=caminho[i], b=caminho[i+1];
      if(andou(a,b)){
        const rua = D.nomes[D.arestas[a>>2][7]], livre = livreDoEstado(a);
        if(rua !== via || !passos.length || passos[passos.length-1].tipo !== 'siga'){
          via = rua; passos.push({tipo:'siga', rua, metros:0, livre_m:livre});
        }
        const p = passos[passos.length-1];
        p.metros += D.arestas[a>>2][2];
        if(livre !== null && !(p.livre_m !== null && p.livre_m <= livre)) p.livre_m = livre;
      } else if(setorDe(a) !== setorDe(b)){
        const mudou = !mesmoLadoFisico(a,b);
        passos.push({tipo: mudou ? 'mudar_lado' : 'cruzar',
                     rua: D.nomes[D.arestas[a>>2][7]],
                     rampa: temRampa(noDoEstado(a))});
        via = null;
      }
    }
    while(passos.length && passos[passos.length-1].tipo !== 'siga') passos.pop();
    return passos;
  }

  /* Volta que sai e volta no mesmo ponto, perto do tempo pedido.
   * Uma única busca de origem cobre TODAS as idas; só as voltas são por
   * candidato. É o que mantém o tempo de resposta interativo. */
  function rotaCircular(origem, minutos, opts={}){
    const alvo = minutos * K.PASSO_M_POR_MIN;
    const modo = opts.modo || 'passeio';
    const nCand = opts.candidatos || 48;
    const inicios = estadosDoNo(origem);

    // distância caminhada pura, igual ao Python: se medisse com o custo de
    // travessia embutido, a faixa abaixo mudaria de significado
    const porDistancia = dijkstra(inicios, 'comprimento', null).dist;
    const arvore = dijkstra(inicios, modo, null);

    let candidatos = [];
    for(let s=0;s<porDistancia.length;s++){
      const d = porDistancia[s];
      if(d >= 0.40*alvo && d <= 0.55*alvo && isFinite(arvore.dist[s])) candidatos.push(s);
    }
    if(!candidatos.length) return null;

    let semente = opts.semente || 1;
    const rnd = () => (semente = (semente*1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for(let i=candidatos.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [candidatos[i],candidatos[j]]=[candidatos[j],candidatos[i]]; }
    candidatos = candidatos.slice(0, nCand);

    let melhor = null;
    const inicioSet = new Set(inicios);
    for(const volta of candidatos){
      const ida = reconstruir(arvore.veio, volta);
      const usados = new Set();
      for(let i=0;i<ida.length-1;i++) if(andou(ida[i], ida[i+1])) usados.add(ida[i]>>2);
      const r = dijkstraEvitando(volta, s => s === ida[0], modo, usados);
      if(!r) continue;
      const caminho = ida.concat(r.slice(1));
      const res = resumir(caminho);
      if(!res.distancia_m) continue;
      /* A qualidade que escolhe o ponto de retorno é a da PREFERÊNCIA pedida.
       * Zerá-la fora do modo 'passeio' desligava o critério em vez de mudá-lo,
       * e a volta "com sombra" vinha com MENOS sombra que a comum. */
      const pref = PREFERENCIAS[modo];
      const extra = pref ? (pref.sombra || pref.parque || 0) : 0;
      const iCom = pref && pref.sombra ? 8 : 9;
      let notaSoma=0, qSoma=0, andados=0; const distintos=new Set();
      for(let i=0;i<caminho.length-1;i++) if(andou(caminho[i],caminho[i+1])){
        const t=caminho[i]>>2, a=D.arestas[t], m=a[2];
        notaSoma += a[6]*m; andados++; distintos.add(t);
        qSoma += ((1-extra)*a[6] + extra*(a[iCom]||0)) * m; }
      const nota = notaSoma / res.distancia_m;
      const q = pref ? qSoma / res.distancia_m : 0;
      const repetido = andados ? 1 - distintos.size/andados : 1;
      /* e a norma pesa na escolha, não só no caminho */
      const fora = res.distancia_m ? res.metros_ruins / res.distancia_m : 0;
      const score = q - 0.7*Math.abs(res.distancia_m - alvo)/alvo
                  - 0.8*repetido - 0.6*fora;
      if(!melhor || score > melhor.score)
        melhor = {score, caminho, nota, repetido, alvo_m: alvo, ...res};
    }
    return melhor;
  }

  function dijkstraEvitando(inicio, ehAlvo, modo, evitar){
    const dist = new Float64Array(D.arestas.length*4).fill(Infinity);
    const veio = new Int32Array(D.arestas.length*4).fill(-1);
    const h = new Heap(); dist[inicio]=0; h.push(0, inicio);
    while(h.tamanho){
      const [d, s] = h.pop();
      if(d > dist[s]) continue;
      if(ehAlvo(s)) return reconstruir(veio, s);
      for(const [s2, custo] of vizinhos(s, modo)){
        const penal = (andou(s,s2) && evitar.has(s>>2)) ? 5.0 : 1.0;
        const nd = d + custo*penal;
        if(nd < dist[s2]){ dist[s2]=nd; veio[s2]=s; h.push(nd, s2); }
      }
    }
    return null;
  }

  const TIPOS_REPORT = {
    obra:           {peso: 4.0, meiaVida: 30},
    entulho:        {peso: 3.0, meiaVida: 7},
    carro_calcada:  {peso: 2.5, meiaVida: 0.25},
    rampa_quebrada: {peso: 3.5, meiaVida: 60},
  };
  /* ---------------- a escolha entre rotas ----------------
   *
   * Um único peso entrega uma rota só, e ela às vezes perde da mais curta em um
   * indicador — trocava travessia com rampa por sombra, e chegava 1 minuto
   * depois. O produto não quer isso: quer a rota que ganha em TUDO que dá para
   * ganhar dentro de um orçamento de tempo. Então o motor gera candidatas com
   * leituras diferentes de "melhor", mede todas pela mesma régua e escolhe.
   *
   * Duas consequências que são de propósito: se nenhuma candidata compensa, a
   * resposta é a própria rota mais curta — ela também pode ser a melhor; e se
   * ganhar tudo custaria mais que o orçamento, a escolhida abre mão de um
   * indicador e o app diz de qual. */
  const FOLGA_MIN = 5.0;    // minutos que a pessoa aceita andar a mais

  const CALIBRAGENS = [
    {rotulo: "equilíbrio",        cal: {}},
    {rotulo: "evita degrau",      cal: {semRampa: 6.0}},
    {rotulo: "exige largura",     cal: {multLargura: 6.0}},
    {rotulo: "largura e degrau",  cal: {multLargura: 6.0, semRampa: 6.0, multDeclive: 4.0}},
    {rotulo: "menos travessia",   cal: {travessia: 45.0, semRampa: 4.0}},
    {rotulo: "travessia com rampa", cal: {travessia: 12.0, semRampa: 10.0}},
  ];

  const INDICADORES = [
    {chave: "pct_ruim",     rotulo: "metros fora da norma", maior: false},
    {chave: "pior_livre_m", rotulo: "pior faixa livre",     maior: true},
    {chave: "sem_rampa",    rotulo: "travessias sem rampa", maior: false},
    {chave: "nota",         rotulo: "nota de passeio",      maior: true},
  ];

  /* Empate conta como não perder. Faixa livre desconhecida nos dois lados não
   * decide nada: comparar null com número inventaria uma vitória. */
  function placar(nossa, curta){
    const ganha = [], perde = [];
    for(const ind of INDICADORES){
      const a = nossa[ind.chave], b = curta[ind.chave];
      if(a === null || b === null || a === b) continue;
      ((ind.maior ? a > b : a < b) ? ganha : perde).push(ind.rotulo);
    }
    return {ganha, perde, pontos: ganha.length - perde.length};
  }

  /* O miolo da escolha: gera candidatas trocando a calibração, mede todas pela
   * mesma régua e ordena pelo placar.
   *
   * Vale só para ir de A a B. Na volta circular não há do que comparar: a volta
   * "mais curta" com o mesmo alvo de tempo é outra caminhada, por outras ruas —
   * comparar as duas mede acaso, não decisão. Lá o motor entrega a volta da
   * preferência pedida e mostra o que ela é. */
  function escolherEntre(fnCurta, fnCandidata, opts = {}){
    const folga = opts.folgaMin === undefined ? FOLGA_MIN : opts.folgaMin;
    const calibragens = opts.calibragens || CALIBRAGENS;
    const pesos = opts.pesos || ["cost"];
    const padrao = Object.assign({}, cal);
    try {
      // a linha de base é a de um mapa comum: distância pura, sem saber de guia
      calibrar(Object.assign({}, padrao, {semRampa: 1.0}));
      const cCurta = fnCurta();
      calibrar(padrao);
      if(!cCurta) return null;
      const curta = Object.assign({caminho: cCurta, rotulo: "a mais curta", peso: "base",
                                   ganha: [], perde: [], pontos: 0}, resumir(cCurta));
      const teto = curta.minutos + folga;

      const vistas = new Set(), candidatas = [curta];
      for(const c of calibragens){
        calibrar(Object.assign({}, padrao, c.cal));
        for(const peso of pesos){
          const caminho = fnCandidata(peso);
          if(!caminho) continue;
          const chave = caminho.join(",");
          if(vistas.has(chave)) continue;
          vistas.add(chave);
          const med = resumir(caminho);
          if(med.minutos > teto) continue;         // fora do orçamento de tempo
          candidatas.push(Object.assign({caminho, rotulo: c.rotulo, peso}, med,
                                        placar(med, curta)));
        }
      }
      candidatas.sort((a, b) =>
        b.pontos - a.pontos || a.perde.length - b.perde.length ||
        b.nota - a.nota || a.minutos - b.minutos);
      const nossa = candidatas[0];
      return {curta, nossa, candidatas, folgaMin: folga, tetoMin: teto,
              aMaisCurtaVenceu: nossa === curta,
              minutosAMais: nossa.minutos - curta.minutos};
    } finally {
      calibrar(padrao);
    }
  }

  function escolherRota(origem, destino, pref, opts = {}){
    const pesos = pref === "cost" ? ["cost"] : [pref, "cost"];
    return escolherEntre(() => rotear(origem, destino, "base"),
                         peso => rotear(origem, destino, peso),
                         Object.assign({pesos}, opts));
  }

  function definirReports(lista){
    reports = new Map();
    for(const r of lista){
      const t = TIPOS_REPORT[r.tipo];
      const dec = Math.pow(0.5, (r.diasAtras||0) / t.meiaVida);
      const k = r.trecho*2 + r.lado;
      reports.set(k, (reports.get(k) || 1.0) + t.peso*(r.confirmacoes||1)*dec);
    }
  }
  const calibrar = o => Object.assign(cal, o);

  return {iniciar, rotear, rotaCircular, resumir, instrucoes, definirReports, calibrar,
          escolherRota, INDICADORES, CALIBRAGENS, FOLGA_MIN,
          estadosDoNo, andou, setorDe, noDoEstado, custoTrecho, TIPOS_REPORT,
          get dados(){ return D; }, get calibracao(){ return cal; }};
})();
