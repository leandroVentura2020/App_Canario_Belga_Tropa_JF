# Tropa dos Belgas

PWA para Android feito com React, Vite e Tailwind CSS. O app mede o tempo total em que um canario belga ficou cantando durante uma prova, sem transformar a quantidade de cantos em pontuacao principal.

## Funcionalidades

- Provas de 3, 5, 10 minutos ou duração personalizada.
- Controle grande de `START CANTO` e `STOP CANTO`.
- Soma precisa dos intervalos cantados usando `performance.now()`.
- Pausa da prova também pausa o trecho de canto em andamento.
- Resultado final com tempo total cantado, percentual, maior sequência e entradas de canto.
- Histórico local com nome opcional do canário.
- Preferência de duração salva no `localStorage`.
- Vibração em Android quando inicia ou para o canto.
- Bip ao finalizar a prova.
- Aviso visual no minuto final.
- Manifest e Service Worker para instalação e uso offline.

## Como rodar

```bash
npm install
npm run dev
```

Depois abra o endereço mostrado pelo Vite no navegador.

## Build de produção

```bash
npm run build
npm run preview
```

## Publicar grátis no GitHub Pages

O projeto já inclui o workflow em `.github/workflows/deploy.yml`.

1. Crie um repositório no GitHub.
2. Envie estes arquivos para a branch `main`.
3. No GitHub, abra `Settings > Pages`.
4. Em `Build and deployment`, selecione `Source: GitHub Actions`.
5. Faça um push para a branch `main`.
6. Aguarde a action `Deploy to GitHub Pages` terminar.

O link final fica parecido com:

```text
https://seu-usuario.github.io/nome-do-repositorio/
```

## Instalar no Android

1. Publique o app em HTTPS, como pelo GitHub Pages.
2. Abra o site no Chrome do Android.
3. Toque no menu do Chrome.
4. Escolha `Instalar app` ou `Adicionar à tela inicial`.
5. Depois da primeira abertura, o Service Worker mantém o app disponível offline.

Durante desenvolvimento em rede local, alguns recursos de PWA podem exigir HTTPS ou `localhost`, conforme as regras do navegador.
