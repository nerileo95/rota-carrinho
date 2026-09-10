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
    // Vencedora da varredura de 3179 calibrações contra 205 trajetos
    // (madrugada de 10/09). Não são números escolhidos a dedo: são o topo de uma
    // busca cujo critério é o mesmo placar que a tela mostra.
    cal = { travessia: K.TRAVESSIA_M, multLargura: 6.64, multDeclive: 1,
            multIncerteza: 1.012, semRampa: 7.205, guiaAlta: 16.25,
            permitirEscada: false,
            multPiso: 1.314, multSemCalcada: 1.114,
            mSemaforo: 0.568, mFaixa: 0.904, barreiraM: 1.941,
            qA: 0.666, qB: 1.533,
            // largura que o carrinho da pessoa precisa; abaixo disso o lado
            // da calçada some do grafo, não fica caro
            bloqueio: K.FAIXA_BLOQUEIO_M };
    // os conjuntos nascem aqui, e não em cada página que usa o motor: eram três
    // cópias da mesma linha, e a quarta ia esquecer
    for(const [campo, chave] of [["_rampa","rampa"], ["_guiaAlta","guia_alta"],
                                ["_escadas","escadas"], ["_semaforo","semaforo"],
                                ["_faixa","faixa"], ["_barreira","barreira"]])
      D[campo] = new Set(D[chave] || []);
    incidentes = Array.from({length: D.nos.length}, () => []);
    D.arestas.forEach((a, i) => { incidentes[a[0]].push(i*2); incidentes[a[1]].push(i*2+1); });
    return { estados: D.arestas.length*4, nos: D.nos.length, escadas: D._escadas.size };
  }

  const noDoEstado = s => { const t=s>>2, p=(s>>1)&1; return D.arestas[t][p?1:0]; };
  const livreDoEstado = s => D.arestas[s>>2][3 + (s&1)];
  const setorDe = s => D.setores[s>>2][((s>>1)&1)*2 + (s&1)];
  const temRampa = n => D._rampa.has(n);
  const guiaDe = n => D._rampa.has(n) ? "rampa" : D._guiaAlta.has(n) ? "guia_alta" : null;
  /* Semáforo e faixa estão muito melhor mapeados que a guia: 1.144 cruzamentos
   * com faixa contra 210 com rebaixamento. Ignorá-los era jogar fora o sinal
   * mais denso que a área tem sobre travessia. */
  const fatorTravessia = n => D._semaforo.has(n) ? cal.mSemaforo
                            : D._faixa.has(n) ? cal.mFaixa : 1.0;

  /* Escadaria e calçada abaixo de 0,60 m não são caras: são impossíveis com
   * carrinho. Nenhum peso resolve isso — o que resolve é o arco não existir.
   * O trecho continua na geometria e continua contando para os setores da
   * esquina; só não dá para andar nele. */
  function proibido(s){
    const t = s>>2;
    if(D._escadas.has(t) && !cal.permitirEscada) return true;
    const livre = D.arestas[t][3 + (s&1)];
    return livre !== null && livre < cal.bloqueio;
  }

  /* Os limiares vêm da norma; os multiplicadores são escolha de projeto. */
  function penalidade(livre, declividade, bandeiras){
    let p = livre === null ? cal.multIncerteza : 1.0;
    if(livre !== null){
      if(livre < K.FAIXA_LIVRE_MIN_M) p *= cal.multLargura;
      if(livre < K.FAIXA_BLOQUEIO_M)  p *= cal.multLargura;
    }
    if(declividade > K.DECLIVIDADE_MAX_PCT) p *= cal.multDeclive;
    // 1 = piso que sacode o carrinho, 2 = rua sem calçada (anda-se no leito)
    if(bandeiras & 1) p *= cal.multPiso;
    if(bandeiras & 2) p *= cal.multSemCalcada;
    return p;
  }

  /* As oito combinações de bandeira, vindas prontas do Python (`D.misturas`).
   * Elas se COMBINAM: quem marca sombra e praça recebe as duas, com a soma
   * limitada — senão marcar tudo viraria "qualquer coisa menos calçada boa". */
  const IDX_COMPONENTE = {sombra: 8, parque: 9, turismo: 12};
  const preferencias = () => D.misturas || {passeio: {}};
  const nomeDoModo = bandeiras => {
    const ativos = ["sombra", "parque", "turismo"].filter(b => bandeiras && bandeiras[b]);
    return ativos.length ? ativos.join("+") : "passeio";
  };

  function custoTrecho(s, modo){
    const t = s>>2, a = D.arestas[t], livre = a[3 + (s&1)];
    const mult = reports.get(t*2 + (s&1)) || 1.0;
    if(modo === 'comprimento') return a[2];          // metros puros, sem report
    if(modo === 'base')    return a[2] * mult;
    // sobre o custo com a penalidade da norma dentro, não sobre os metros
    // crus: senão o passeio compra sombra com calçada estreita
    const p = preferencias()[modo];
    if(p) {
      // A base continua sendo a nota inteira: "mais sombra" não é "só sombra",
      // senão a rota vira um túnel de árvores por calçada ruim.
      let extra = 0, soma = 0;
      for(const k in p){ extra += p[k]; soma += p[k] * (a[IDX_COMPONENTE[k]] || 0); }
      const n = (1 - extra) * a[6] + soma;
      return a[2] * penalidade(livre, a[5], a[11]|0) / (cal.qA + cal.qB*n) * mult;
    }
    return a[2] * penalidade(livre, a[5], a[11]|0) * mult;      // 'cost'
  }

  /* Vizinhos calculados na hora: materializar os 128.488 arcos de transição
   * seria desperdício de memória e de tempo de carga. */
  function vizinhos(s, modo){
    const t = s>>2, ponta = (s>>1)&1, lado = s&1, saida = [];
    // única porta de entrada para "andar num trecho" em todo o motor: rotear,
    // escolherRota, rotaCircular e dijkstraEvitando passam todos por aqui
    if(!proibido(s)) saida.push([t*4 + (1-ponta)*2 + lado, custoTrecho(s, modo), D.arestas[t][2]]);
    const no = noDoEstado(s), meu = setorDe(s);
    const guia = guiaDe(no);
    // em 'comprimento' a travessia não soma metros — é o que o Python mede
    const custoTravessia = modo === 'comprimento' ? 0
      : cal.travessia * fatorTravessia(no)
        * (guia === "rampa" ? 1.0 : guia === "guia_alta" ? cal.guiaAlta : cal.semRampa);
    // barreira física atrapalha mesmo quem só dobra a esquina
    const custoBarreira = modo === 'comprimento' || !D._barreira.has(no) ? 0 : cal.barreiraM;
    for(const ponta2 of incidentes[no]){
      const t2 = ponta2>>1, p2 = ponta2&1;
      for(let l2 = 0; l2 < 2; l2++){
        const s2 = t2*4 + p2*2 + l2;
        if(s2 === s) continue;
        saida.push([s2, (setorDe(s2) === meu ? 0 : custoTravessia) + custoBarreira, 0]);
      }
    }
    return saida;
  }

  /* O preço de UM passo, para quem precisa reprecificar um caminho já pronto —
   * hoje só a paridade. O laço do Dijkstra não usa esta função: lá o custo da
   * travessia é içado para fora do laço de vizinhos, que é o trecho quente do
   * motor. A fórmula está escrita duas vezes de propósito, e a paridade contra
   * o Python é o que garante que as duas concordam. */
  function custoPasso(a, b, modo){
    if(andou(a, b)) return custoTrecho(a, modo);
    const no = noDoEstado(a), guia = guiaDe(no);
    const trav = setorDe(a) === setorDe(b) ? 0
      : cal.travessia * fatorTravessia(no)
        * (guia === "rampa" ? 1.0 : guia === "guia_alta" ? cal.guiaAlta : cal.semRampa);
    return trav + (D._barreira.has(no) ? cal.barreiraM : 0);
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
      for(const s of [t*4+p*2, t*4+p*2+1]) if(!proibido(s)) r.push(s); }
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
    let dist=0, ruins=0, travessias=0, pior=Infinity, semRampa=0, guiaAlta=0, notaSoma=0;
    for(let i=0;i<caminho.length-1;i++){
      const a=caminho[i], b=caminho[i+1];
      if(andou(a,b)){
        const t = a>>2, m = D.arestas[t][2], livre = livreDoEstado(a);
        dist += m; notaSoma += D.arestas[t][6] * m;
        if(livre !== null){ if(livre < K.FAIXA_LIVRE_MIN_M) ruins += m; pior = Math.min(pior, livre); }
      } else if(setorDe(a) !== setorDe(b)){
        travessias++;
        const g = guiaDe(noDoEstado(a));
        if(g !== "rampa") semRampa++;
        if(g === "guia_alta") guiaAlta++;
      }
    }
    return {distancia_m: dist, metros_ruins: ruins, travessias, sem_rampa: semRampa,
            guia_alta: guiaAlta,
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
      if(d >= 0.40*alvo && d <= 0.55*alvo && isFinite(arvore.dist[s]) && !proibido(s))
        candidatos.push(s);
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
      const pref = preferencias()[modo];
      let notaSoma=0, qSoma=0, andados=0; const distintos=new Set();
      for(let i=0;i<caminho.length-1;i++) if(andou(caminho[i],caminho[i+1])){
        const t=caminho[i]>>2, a=D.arestas[t], m=a[2];
        notaSoma += a[6]*m; andados++; distintos.add(t);
        let extra=0, soma=0;
        if(pref) for(const k in pref){ extra += pref[k]; soma += pref[k]*(a[IDX_COMPONENTE[k]]||0); }
        qSoma += ((1-extra)*a[6] + soma) * m; }
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

  /* As seis leituras que a varredura escolheu, e não seis palpites. O conjunto
   * foi montado por seleção gulosa sobre a tabela de indicadores: cada leitura
   * entrou porque acrescentava trajetos que as anteriores não ganhavam. A
   * sétima não pagava mais o seu Dijkstra. */
  /* As seis leituras que a varredura escolheu, e não seis palpites. O conjunto
   * saiu de 3179 calibrações medidas contra 205 trajetos, por
   * seleção gulosa sobre a tabela de indicadores: cada leitura entrou porque
   * acrescentava trajetos que as anteriores não ganhavam. A sétima não pagava
   * mais o seu Dijkstra. */
  const CALIBRAGENS = [
    {rotulo: "guia rebaixada acima de tudo",
     cal: {multLargura: 6.64, multDeclive: 1, multIncerteza: 1.012, travessia: 12.449, semRampa: 7.205, guiaAlta: 16.25, multPiso: 1.314, multSemCalcada: 1.114, mSemaforo: 0.568, mFaixa: 0.904, barreiraM: 1.941, qA: 0.666, qB: 1.533}},
    {rotulo: "travessia protegida",
     cal: {multLargura: 4.462, multDeclive: 2.572, multIncerteza: 1.083, travessia: 15.114, semRampa: 6.044, guiaAlta: 6.602, multPiso: 1.094, multSemCalcada: 4.361, mSemaforo: 0.446, mFaixa: 0.563, barreiraM: 11.161, qA: 0.65, qB: 1.259}},
    {rotulo: "terreno e piso",
     cal: {multLargura: 1.634, multDeclive: 3.834, multIncerteza: 1.018, travessia: 17.821, semRampa: 7.193, guiaAlta: 8.39, multPiso: 2.066, multSemCalcada: 2.046, mSemaforo: 0.803, mFaixa: 0.938, barreiraM: 6.798, qA: 0.424, qB: 1.265}},
    {rotulo: "menos travessia",
     cal: {multLargura: 10.679, multDeclive: 2.454, multIncerteza: 2.253, travessia: 49.217, semRampa: 7.849, guiaAlta: 4.738, multPiso: 1.277, multSemCalcada: 2.649, mSemaforo: 0.902, mFaixa: 0.892, barreiraM: 26.015, qA: 0.493, qB: 0.592}},
    {rotulo: "evita degrau",
     cal: {multLargura: 5.241, multDeclive: 1.289, multIncerteza: 1.06, travessia: 10.64, semRampa: 10.635, guiaAlta: 4.1, multPiso: 2.146, multSemCalcada: 2.796, mSemaforo: 0.851, mFaixa: 0.978, barreiraM: 13.933, qA: 0.514, qB: 0.787}},
    {rotulo: "desvia de barreira",
     cal: {multLargura: 5.299, multDeclive: 4.256, multIncerteza: 1.045, travessia: 26.711, semRampa: 4.534, guiaAlta: 8.405, multPiso: 1.232, multSemCalcada: 1.001, mSemaforo: 0.949, mFaixa: 0.724, barreiraM: 47.809, qA: 0.411, qB: 1.347}},
  ];

  /* Os quatro indicadores não valem o mesmo. Um degrau na travessia é o que
   * faz a pessoa desistir do trajeto e voltar; a nota de passeio é conforto.
   * O peso entra no placar, e é o mesmo número que a busca de parâmetros
   * otimiza — o app relata exatamente aquilo que foi maximizado. */
  const INDICADORES = [
    {chave: "sem_rampa",    rotulo: "travessias sem rampa", maior: false, peso: 2.0},
    {chave: "pct_ruim",     rotulo: "metros fora da norma", maior: false, peso: 1.5},
    {chave: "pior_livre_m", rotulo: "pior faixa livre",     maior: true,  peso: 1.5},
    {chave: "nota",         rotulo: "nota de passeio",      maior: true,  peso: 1.0},
  ];

  /* Empate conta como não perder. Faixa livre desconhecida nos dois lados não
   * decide nada: comparar null com número inventaria uma vitória. */
  /* Serve ao veredito: "o mapa comum te mandaria pela escada, e o nosso não". */
  function temEscada(caminho){
    for(let i=0;i<caminho.length-1;i++)
      if(andou(caminho[i], caminho[i+1]) && D._escadas.has(caminho[i]>>2)) return true;
    return false;
  }

  function placar(nossa, curta){
    const ganha = [], perde = [];
    let pontos = 0;
    for(const ind of INDICADORES){
      const a = nossa[ind.chave], b = curta[ind.chave];
      if(a === null || b === null || a === b) continue;
      const venceu = ind.maior ? a > b : a < b;
      (venceu ? ganha : perde).push(ind.rotulo);
      pontos += venceu ? ind.peso : -ind.peso;
    }
    return {ganha, perde, pontos};
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
      // A linha de base é a de um mapa comum: distância pura, sem saber de guia
      // — e livre para mandar pela escadaria, que é o que ela de fato faz em
      // 35,8% das rotas desta área. É essa diferença que o placar mostra.
      calibrar(Object.assign({}, padrao, {semRampa: 1.0, guiaAlta: 1.0,
                                          permitirEscada: true}));
      const cCurta = fnCurta();
      calibrar(padrao);
      if(!cCurta) return null;
      const curta = Object.assign({caminho: cCurta, rotulo: "a mais curta", peso: "base",
                                   ganha: [], perde: [], pontos: 0}, resumir(cCurta));
      const teto = curta.minutos + folga;

      /* A curta permissiva é RÉGUA, nunca resposta: entregá-la seria mandar a
       * pessoa pela escadaria com o carrinho. Quem entra na disputa é a rota
       * mais curta que respeita as proibições — é ela que responde quando
       * nenhuma leitura compensa. Quando as duas coincidem, o placar zera e o
       * app diz "a mais curta já é a melhor". */
      /* E ela é a mais curta DE VERDADE: sem os agravos de travessia da
       * calibração em vigor, que a fariam desviar atrás de guia rebaixada e
       * deixariam de ser "a mais curta". Só a proibição continua valendo. */
      calibrar(Object.assign({}, padrao, {semRampa: 1.0, guiaAlta: 1.0, mSemaforo: 1.0,
                                          mFaixa: 1.0, barreiraM: 0, multPiso: 1.0,
                                          multSemCalcada: 1.0, permitirEscada: false}));
      const cLegal = fnCurta();
      calibrar(padrao);
      const vistas = new Set(), candidatas = [];
      if(cLegal){
        const med = resumir(cLegal);
        vistas.add(cLegal.join(","));
        candidatas.push(Object.assign({caminho: cLegal, rotulo: "a mais curta", peso: "base"},
                                      med, placar(med, curta)));
      }
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
      if(!nossa) return null;      // origem ou destino fora do componente
      return {curta, nossa, candidatas, folgaMin: folga, tetoMin: teto,
              aMaisCurtaVenceu: nossa.peso === "base" && !nossa.ganha.length,
              curtaUsaEscada: temEscada(cCurta),
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
          escolherRota, temEscada, custoPasso, nomeDoModo, INDICADORES, CALIBRAGENS, FOLGA_MIN,
          estadosDoNo, andou, setorDe, noDoEstado, custoTrecho, TIPOS_REPORT,
          get dados(){ return D; }, get calibracao(){ return cal; }};
})();
