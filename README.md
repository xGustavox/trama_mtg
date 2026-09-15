# Trama MTG Tracker

Marcador de vida de Magic: The Gathering pensado para tablets e partidas de 2 a 8 jogadores.

## Executar

Não há dependências ou etapa de build. Sirva a pasta com qualquer servidor HTTP local, por exemplo:

```sh
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## Funcionalidades

- Grade adaptável de 2 a 8 jogadores em paisagem ou retrato
- Fileira oposta rotacionada para cada jogador ler sua área do próprio lado da mesa
- Ordem de turnos em sentido horário, com número do turno no botão central
- Novo jogo permanece pausado até tocar em “Começar jogo”
- Toque no lado esquerdo para perder 1 vida e no direito para ganhar 1; segure para alterar 10 continuamente
- Relógio individual de 30 minutos, turno em azul e prioridade temporária em amarelo
- Dano de comandante separado por oponente, com controles de toque e pressão longa
- Nomes editáveis, desfazer e vida inicial de 20, 30 ou 40
- Fundo com cor predefinida, seletor personalizado ou arte buscada no Scryfall
- Seletor visual para reutilizar configurações de jogadores salvos
- Barra lateral para nova partida, quantidade de jogadores, desfazer e tela cheia
- Partida e perfis reutilizáveis de nome, imagem e cor salvos no navegador
- Modo tela cheia quando suportado pelo navegador

Dados e imagens de cartas são fornecidos pelo [Scryfall](https://scryfall.com). Magic: The Gathering é propriedade da Wizards of the Coast.
