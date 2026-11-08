# EDGE NBA AI — estratégia de dados gratuitos (v0.3)

## Fontes escolhidas

1. **ESPN public site API** — calendário/scoreboard, injury report e resumo de cada jogo. É uma API pública não documentada como produto com SLA; os endpoints são usados como fonte complementar e têm de ser monitorizados. Não assumir disponibilidade permanente.
2. **BigBallsData NBA Player Stats** — plano gratuito documenta 250 pedidos/dia (500 com GitHub) e disponibiliza endpoints de pesquisa de jogadores, game logs e box scores; a profundidade histórica acessível depende do plano. A cobertura publicada do dataset vai de 2019-20 a 2025-26. Confirmar o acesso efetivo do plano gratuito e a cobertura 2026-27 antes de usar. Requer API key gratuita, guardada exclusivamente como Worker secret.
3. **NBA.com** — fonte oficial para validação manual/independente. Não é tratada como API de produção até se provar estabilidade, cobertura e permissões.

## Limitações reais

- BigBallsData Free não equivale a acesso completo a todas as épocas/estatísticas; a profundidade histórica depende do plano. Testar a época e os endpoints concretos antes de os considerar disponíveis.
- ESPN não publica SLA nem rate limit formal para estes endpoints. Cachear respostas e limitar pedidos.
- Dados de lesões e escalações são snapshots: guardar timestamp, fonte e estado; voltar a consultar perto do jogo.
- Box scores passados não contêm, por si só, todo o contexto pré-jogo (papel, restrições de minutos, mudanças táticas).
- A recolha de todos os jogadores exige estratégia de cobertura, não dezenas/centenas de pedidos por jogador em cada execução. Cachear IDs e logs; nunca exceder quotas.
- Sem odds introduzidas pelo utilizador, não existe EV de aposta.
- Sem backtesting temporal e calibração fora da amostra, não publicar probabilidades como se fossem fiáveis.

## Portas de qualidade

- **G0 — calendário:** todos os jogos do dia identificados e reconciliados.
- **G1 — jogadores:** cobertura do roster/ativos e dos registos individuais declarada; ausências de dados visíveis.
- **G2 — contexto:** injury report com timestamp; estados questionáveis modelados em cenários separados, não tratados como ausências confirmadas.
- **G3 — projeção:** estatísticas por jogo, minutos, amostras, mediana, dispersão e alterações de papel.
- **G4 — calibração:** backtest walk-forward, Brier score/log loss, calibração por mercado e comparação com baseline.
- **G5 — ranking:** até 10 candidatos; menos de 10 se não passarem os critérios. Não usar hit rate simples como probabilidade.
- **G6 — valor:** só depois de o utilizador fornecer a linha e a odd decimal. EV calculado com probabilidade calibrada e intervalo de incerteza.

## Política de não-invenção

Se um endpoint falhar, um jogador não for encontrado, a época não estiver coberta ou a lesão não estiver confirmada, o sistema deve assinalar a falha e reduzir a cobertura. Não substituir valores em falta por zero, não inferir ausência a partir de silêncio e não preencher Top 10 artificialmente.

## Configuração gratuita da chave BigBallsData

1. Criar uma conta gratuita no portal BigBallsData e gerar uma chave NBA.
2. No terminal Wrangler, executar `wrangler secret put BIGBALLSDATA_API_KEY` dentro da pasta do Worker e colar a chave no prompt privado.
3. Nunca colocar a chave em `src/`, no GitHub, no navegador ou numa mensagem de chat.
4. Para o frontend, definir `VITE_API_BASE` com o endereço HTTPS do Worker, ou configurar um route `/api/*` no mesmo domínio.

A chave não é necessária para testar o calendário/lesões ESPN. É necessária para os endpoints BigBallsData.
