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
  /* A nota do LADO andado, não a da rua.
   *
   * A nota é composta em `motor.py`, e o componente de largura usava o melhor
   * dos dois lados — o que responde "quão boa é esta rua", a pergunta do
   * dashboard. O app pergunta outra coisa: "quão boa é esta caminhada". Com o
   * máximo, atravessar para a calçada boa não mexia na nota, e a tabela mostrava
   * empate onde o placar contava vitória.
   *
   * Quem entra no CUSTO de roteamento continua sendo a nota da rua (`a[6]`): o
   * custo gera candidatas, o placar julga. Trocar os dois de uma vez mudaria as
   * rotas e invalidaria a calibração da madrugada. */
  const notaDoEstado = s => {
    const a = D.arestas[s>>2];
    const n = a[13 + (s&1)];
    return n === undefined || n === null ? a[6] : n;
  };
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

  /* Média dos componentes ao longo do trajeto, ponderada por metro. Saber que
   * sombra é a coluna 8 da aresta é conhecimento do motor, não da tela: as duas
   * páginas pedem isto, e uma segunda cópia seria uma segunda chance de errar
   * o índice. "toca" conta as quadras que encostam de fato numa praça. */
  function mediasDe(caminho){
    const soma = {sombra: 0, parque: 0, turismo: 0};
    let dist = 0, toca = 0;
    for(let i=0;i<caminho.length-1;i++){
      if(!andou(caminho[i], caminho[i+1])) continue;
      const a = D.arestas[caminho[i]>>2], m = a[2];
      for(const k in IDX_COMPONENTE) soma[k] += (a[IDX_COMPONENTE[k]] || 0) * m;
      dist += m;
      if((a[IDX_COMPONENTE.parque] || 0) >= .999) toca++;
    }
    if(!dist) return {sombra: 0, parque: 0, turismo: 0, toca: 0};
    for(const k in soma) soma[k] /= dist;
    return Object.assign(soma, {toca});
  }
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
        dist += m; notaSoma += notaDoEstado(a) * m;
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

  /* Os trechos andados, cada um com o deslocamento FÍSICO da calçada em que se
   * anda. É semântica do trajeto, não desenho — por isso mora aqui e não no
   * mapa, e por isso a regressão consegue prendê-la.
   *
   * O rótulo E/D da aresta vale dentro do seu trecho e **não é comparável entre
   * trechos** (ver `classificar_lados`, no motor.py). Medido: em 11% das emendas
   * retas sem travessia dois trechos seguidos rotulam lados opostos — e o mapa,
   * desenhando pelo rótulo, fazia a rota pular a rua sem ninguém ter
   * atravessado. Eram esses os "desvios" em zigue-zague.
   *
   * Quem manda sobre continuidade é o SETOR: ele agrupa as calçadas da mesma
   * esquina e foi construído e validado no Python. Mesmo setor, mesma calçada.
   * Setor diferente, `mesmoLadoFisico` decide — a mesma função que escolhe entre
   * "atravesse" e "troque para a calçada do outro lado" na fala. O resultado é
   * que o mapa vira exatamente onde a fala manda virar. */
  function ladosDoCaminho(caminho){
    const out = [];
    let anterior = null, desloc = null;
    for(let i=0;i<caminho.length-1;i++){
      const a = caminho[i];
      if(!andou(a, caminho[i+1])) continue;
      let v = deslocDe(a);
      if(anterior !== null){
        const mesmoLado = setorDe(anterior) === setorDe(a) || mesmoLadoFisico(anterior, a);
        const juntos = v[0]*desloc[0] + v[1]*desloc[1] > 0;
        if(mesmoLado !== juntos) v = [-v[0], -v[1]];
      }
      out.push({t: a>>2, lado: a&1, desloc: v, i});
      anterior = caminho[i+1]; desloc = v;
    }
    return out;
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
  /* Componentes que são LUGAR, e não propriedade da rua: dá para mirar numa
   * praça, não dá para mirar em sombra — ela está ao longo do caminho, não no
   * fim dele. É a diferença entre "passe por onde tem árvore" e "vá até lá". */
  const ALVOS = ['parque', 'turismo'];

  function rotaCircular(origem, minutos, opts={}){
    const alvo = minutos * K.PASSO_M_POR_MIN;
    const modo = opts.modo || 'passeio';
    const nCand = opts.candidatos || 48;
    /* Sem repetir trecho, a volta é um circuito de verdade. É o padrão: quem
     * pede uma volta quer dar a volta. Antes isto era uma penalidade de 5× no
     * custo, e 18 de 108 voltas medidas repetiam mesmo assim. */
    const semRepetir = opts.semRepetir !== false;
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
    const embaralhar = xs => {
      for(let i=xs.length-1;i>0;i--){ const j=Math.floor(rnd()*(i+1)); [xs[i],xs[j]]=[xs[j],xs[i]]; }
      return xs;
    };

    /* MIRAR no alvo, e não só andar perto dele.
     *
     * O ponto de retorno era sorteado só por distância, embaralhado uniforme e
     * cortado nos primeiros 48 — nada puxava a volta para onde as praças estão.
     * O componente de praça é um gradiente de proximidade, então a volta colhia
     * média alta (0,45 -> 0,69 ao pedir praça) sem nunca encostar numa: medido,
     * quatro de cinco origens davam ZERO trechos colados numa praça.
     *
     * Agora, quando a preferência pede um LUGAR, os candidatos que ficam colados
     * nele entram primeiro. Se não houver nenhum no raio do tempo pedido, a volta
     * sai como antes e `semAlvo` diz isso — entregar uma volta qualquer e chamar
     * de "praças" seria pior que admitir que não há praça alcançável. */
    const pref = preferencias()[modo];
    const mirados = pref ? ALVOS.filter(k => pref[k]) : [];
    let semAlvo = false;
    if(mirados.length){
      const encosta = s => {
        const a = D.arestas[s>>2];
        return mirados.some(k => (a[IDX_COMPONENTE[k]] || 0) >= 0.999);
      };
      const noAlvo = embaralhar(candidatos.filter(encosta));
      semAlvo = !noAlvo.length;
      candidatos = noAlvo.concat(embaralhar(candidatos.filter(s => !encosta(s))));
    } else {
      embaralhar(candidatos);
    }
    candidatos = candidatos.slice(0, nCand);

    let melhor = null;
    const inicioSet = new Set(inicios);
    for(const volta of candidatos){
      const ida = reconstruir(arvore.veio, volta);
      const usados = new Set();
      for(let i=0;i<ida.length-1;i++) if(andou(ida[i], ida[i+1])) usados.add(ida[i]>>2);
      const r = dijkstraEvitando(volta, s => s === ida[0], modo, usados, semRepetir);
      if(!r) continue;
      const caminho = ida.concat(r.slice(1));
      const res = resumir(caminho);
      if(!res.distancia_m) continue;
      /* A qualidade que escolhe o ponto de retorno é a da PREFERÊNCIA pedida.
       * Zerá-la fora do modo 'passeio' desligava o critério em vez de mudá-lo,
       * e a volta "com sombra" vinha com MENOS sombra que a comum. */
      const pref = preferencias()[modo];
      let notaSoma=0, qSoma=0, andados=0; const distintos=new Set(), noAlvo=new Set();
      for(let i=0;i<caminho.length-1;i++) if(andou(caminho[i],caminho[i+1])){
        const t=caminho[i]>>2, a=D.arestas[t], m=a[2];
        notaSoma += notaDoEstado(caminho[i])*m; andados++; distintos.add(t);
        if(mirados.some(k => (a[IDX_COMPONENTE[k]]||0) >= 0.999)) noAlvo.add(t);
        let extra=0, soma=0;
        if(pref) for(const k in pref){ extra += pref[k]; soma += pref[k]*(a[IDX_COMPONENTE[k]]||0); }
        qSoma += ((1-extra)*a[6] + soma) * m; }
      const nota = notaSoma / res.distancia_m;
      const q = pref ? qSoma / res.distancia_m : 0;
      const repetido = andados ? 1 - distintos.size/andados : 1;
      /* e a norma pesa na escolha, não só no caminho */
      const fora = res.distancia_m ? res.metros_ruins / res.distancia_m : 0;
      /* Encostar VALE, e o gradiente de proximidade não dava conta disso: com
       * ele a volta colhia média alta sem nunca pôr o pé numa praça — quatro de
       * cinco origens davam zero. Dois quarteirões colados no alvo saturam o
       * prêmio: o pedido é "passe por uma praça", não "ande dentro do parque a
       * caminhada inteira". */
      /* E o prêmio só vale dentro do tempo pedido. Sem esta trava ele comprava
       * 30% de caminhada a mais para alcançar uma praça — 39 min para 30
       * pedidos. O tempo que a pessoa pediu é promessa; a praça é preferência. */
      const desvioTempo = Math.abs(res.distancia_m - alvo) / alvo;
      const encostou = mirados.length && desvioTempo <= 0.20
                     ? Math.min(1, noAlvo.size / 2) : 0;
      const score = q + 0.45*encostou - 0.7*desvioTempo - 0.8*repetido - 0.6*fora;
      if(!melhor || score > melhor.score)
        melhor = {score, caminho, nota, repetido, alvo_m: alvo, mirouEm: mirados,
                  tocaAlvo: noAlvo.size, semAlvo, semRepetir, ...res};
    }
    /* Sem repetir pode não haver volta: quarteirão sem saída, ou tempo curto
     * demais para fechar o circuito. Aí vale mais entregar a volta que repete e
     * dizer isso do que não entregar nada. */
    if(!melhor && semRepetir)
      return rotaCircular(origem, minutos, Object.assign({}, opts, {semRepetir: false}));
    return melhor;
  }

  /* `duro` transforma "evitar" em "não existe": é a diferença entre uma volta
   * que prefere não repetir e uma que não repete. */
  function dijkstraEvitando(inicio, ehAlvo, modo, evitar, duro){
    const dist = new Float64Array(D.arestas.length*4).fill(Infinity);
    const veio = new Int32Array(D.arestas.length*4).fill(-1);
    const h = new Heap(); dist[inicio]=0; h.push(0, inicio);
    while(h.tamanho){
      const [d, s] = h.pop();
      if(d > dist[s]) continue;
      if(ehAlvo(s)) return reconstruir(veio, s);
      for(const [s2, custo] of vizinhos(s, modo)){
        const repetindo = andou(s,s2) && evitar.has(s>>2);
        if(repetindo && duro) continue;
        const nd = d + custo*(repetindo ? 5.0 : 1.0);
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

  /* As seis leituras que a varredura escolheu, e não seis palpites.
   *
   * Saíram de 2.659 calibrações medidas na madrugada de 11/09/2026 contra 501
   * trajetos — e, desta vez, medidas do jeito que o app roda: os DOIS pesos e a
   * mesma régua de produção. A varredura anterior media um peso só e uma régua
   * mais fraca, e por isso escolhia sem enxergar 5% das rotas que o app entrega.
   *
   * A seleção é gulosa por COBERTURA: entra a leitura que ganha trajetos que as
   * anteriores não ganhavam, com o vaivém como desempate. E foi validada fora da
   * amostra — escolhida sobre 400 trajetos, medida em 100 que nem a busca nem a
   * seleção enxergaram:
   *
   *     ganha em algum indicador     84 de 100  ->  88 de 100
   *     ganha sem perder em nada     60         ->  70
   *     a mais curta vence            7         ->   6
   *     metros andados de lado    2.114 m       ->  1.647 m
   *
   * pelo mesmo tempo a mais (+1,59 -> +1,62 min mediano). As seis discordam de
   * verdade: `semRampa` vai de 1,7 a 7,6 e `guiaAlta` de 2,5 a 19,5. O conjunto
   * anterior era seis vizinhos do mesmo ponto, porque o refino da busca gastava
   * o tempo polindo um pico em vez de procurar leitura nova. */
  const CALIBRAGENS = [
    {rotulo: "calçada larga, nota alta",
     cal: {multLargura: 4.172, multDeclive: 2.045, multIncerteza: 1, travessia: 13.322, semRampa: 4.349, guiaAlta: 6.695, multPiso: 1.453, multSemCalcada: 2.929, mSemaforo: 0.644, mFaixa: 0.587, barreiraM: 7.337, qA: 0.341, qB: 1.415}},
    {rotulo: "evita travessia e barreira",
     cal: {multLargura: 2.536, multDeclive: 1.937, multIncerteza: 1.725, travessia: 37.637, semRampa: 7.632, guiaAlta: 12.036, multPiso: 2.223, multSemCalcada: 1.693, mSemaforo: 0.964, mFaixa: 0.949, barreiraM: 41.75, qA: 0.322, qB: 0.489}},
    {rotulo: "foge de guia alta",
     cal: {multLargura: 1.924, multDeclive: 2.981, multIncerteza: 1.059, travessia: 15.525, semRampa: 1.726, guiaAlta: 19.463, multPiso: 2.005, multSemCalcada: 4.863, mSemaforo: 0.49, mFaixa: 0.617, barreiraM: 2.19, qA: 0.497, qB: 0.996}},
    {rotulo: "terreno e barreira",
     cal: {multLargura: 2.239, multDeclive: 3.061, multIncerteza: 1.383, travessia: 15.708, semRampa: 1.95, guiaAlta: 3.292, multPiso: 1.662, multSemCalcada: 2.692, mSemaforo: 0.547, mFaixa: 0.842, barreiraM: 20.913, qA: 0.69, qB: 0.585}},
    {rotulo: "largura e ladeira acima de tudo",
     cal: {multLargura: 11.976, multDeclive: 4.712, multIncerteza: 1.028, travessia: 10.471, semRampa: 4.942, guiaAlta: 12.525, multPiso: 1.252, multSemCalcada: 1.762, mSemaforo: 0.962, mFaixa: 0.676, barreiraM: 33.831, qA: 0.2, qB: 0.955}},
    {rotulo: "evita travessia e piso ruim",
     cal: {multLargura: 2.451, multDeclive: 3.412, multIncerteza: 1.672, travessia: 36.447, semRampa: 6.771, guiaAlta: 2.516, multPiso: 2.812, multSemCalcada: 2.577, mSemaforo: 0.403, mFaixa: 0.727, barreiraM: 27.401, qA: 0.231, qB: 1.011}},
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
          /* Fora do orçamento de tempo. O app descarta e mostra só a vencedora;
           * a página que explica a escolha pede para guardar, porque o ponto
           * dela é justamente ver quem cai fora quando o teto se move. */
          const foraDoTeto = med.minutos > teto;
          if(foraDoTeto && !opts.manterForaDoTeto) continue;
          candidatas.push(Object.assign({caminho, rotulo: c.rotulo, peso, foraDoTeto}, med,
                                        placar(med, curta)));
        }
      }
      /* Quem estourou o teto nunca disputa: fica atrás de todo mundo, para que
       * candidatas[0] continue sendo a mesma vencedora de quando elas eram
       * simplesmente descartadas. */
      candidatas.sort((a, b) =>
        (a.foraDoTeto ? 1 : 0) - (b.foraDoTeto ? 1 : 0) ||
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
          escolherRota, temEscada, custoPasso, nomeDoModo, mediasDe, preferencias,
          notaDoEstado, mesmoLadoFisico, deslocDe, ladosDoCaminho,
          INDICADORES, CALIBRAGENS, FOLGA_MIN,
          estadosDoNo, andou, setorDe, noDoEstado, custoTrecho, TIPOS_REPORT,
          get dados(){ return D; }, get calibracao(){ return cal; }};
})();
