# Rota de calçada para quem empurra carrinho

App de rotas a pé que escolhe o caminho pela calçada, e não pela distância.
Área: **Pinheiros, Vila Madalena e Sumarezinho inteiros** — 14,3 km², 10.000
trechos de rua e 8.659 trechos de calçada cadastrados.

**No ar:** https://nerileo95.github.io/rota-carrinho/

Cada trajeto é calculado treze vezes sobre o mesmo grafo — a rota mais curta,
que é o que um mapa comum entrega, e doze leituras diferentes do que "melhor"
quer dizer. Todas são medidas pela mesma régua (metros fora da norma, pior faixa
livre, travessias sem rebaixamento de guia, nota de passeio), e o app entrega a
que ganha em mais indicadores sem estourar o tempo que você aceita andar a mais.
Quando nenhuma compensa, ele entrega a própria rota mais curta e diz isso.

Parâmetros normativos: faixa livre ≥ 1,20 m (Decreto Municipal 59.671/2020),
declividade ≤ 8,33% (NBR 9050), faixa de serviço de 0,70 m descontada onde há
árvore ou poste plantado dentro da calçada.

## Fontes

- **GeoSampa** — polígonos de calçada com largura e declividade, árvores, postes.
- **OpenStreetMap** — rede caminhável, rebaixamentos de guia, praças, endereços
  com número, e os tiles do mapa.

## O que há aqui

Só o site publicado. `index.html` é a página, `motor.js` é o motor de rotas
(Dijkstra sobre um grafo de estados `(trecho, ponta, lado da calçada)`) e
`dados.js` são os dados da área, prontos.

O pipeline que gera tudo isso — notebooks, `motor.py`, `preparar_area.py`,
`exportar_app.py` e o teste de paridade Python↔JS — vive no repositório da POC.
