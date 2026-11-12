# KRadarDetector

Detector de radares **offline** para Android antigo (5.0+), pensado para multimídias automotivas. Usa a base [Pardal](https://github.com/Murkiriel/pardal) e continua funcionando com a tela apagada ou o app minimizado, graças a um **Foreground Service**.

> Uso pessoal. Os dados vêm do Pardal (OpenStreetMap, licença ODbL 1.0) e podem estar desatualizados ou incompletos. Respeite sempre a sinalização e os limites de velocidade.

## Recursos

- **Funciona em segundo plano** (Foreground Service com notificação fixa), via `expo-location` + `expo-task-manager`.
- **100% offline** depois de baixar as bases.
- **Vários estados ao mesmo tempo** (ex.: SP, SC e PR). Você marca/desmarca os estados na tela; tocar de novo num estado selecionado o remove e apaga a base.
- **Atualização inteligente**: ao abrir, o app compara o sha256 publicado na release mais recente do Pardal com o da última instalação e só baixa o que mudou.
- **Avisos falados** (TTS pt-BR): "Radar à frente, limite 60", em duas distâncias configuráveis.
- **Beep contínuo** perto do radar: compassado (1 s) dentro do limite; rápido (0,2 s) se a velocidade passar do limite do radar. O beep é tocado pelo código nativo, então não pausa em segundo plano.
- **Filtro de sentido**: se o radar tem `direction_deg`, é ignorado quando a diferença para o rumo do veículo passa de 60° (só com precisão do GPS ≤ 15 m e veículo em movimento). Radar sem sentido (ou `BOTH`/`UNKNOWN`) avisa nos dois sentidos. Radares que já ficaram para trás também são ignorados.
- **Só radares ativos** (`active = 1`).
- **Botões de teste**: simulam a chegada a um radar real da base (ou fictício, sem base) abaixo e acima do limite.
- **Opções**: distância de início do beep (50–300 m), primeiro aviso (200–600 m ou desligado) e segundo aviso (50–150 m ou desligado).

## Como funciona

1. **Download** (`src/database.js`): baixa `pardal-<UF>.sqlite.zst` da release mais recente, confere o sha256 (`SHA256SUMS.txt`) e descompacta **em streaming** por um módulo nativo (`modules/kradar-zstd`, com `zstd-jni`). A base de SP tem ~86 MB descompactada; carregar isso como texto no JS estoura a memória.
2. **Banco**: `react-native-quick-sqlite` (SQLite embutido), porque o SQLite do sistema no Android 5 é o 3.8 e a base do Pardal pede ≥ 3.22.
3. **Detecção** (`src/detector.js`): a cada atualização de GPS (~2 s), consulta o índice de células (tile zoom 13, 9 células vizinhas), calcula a distância exata, aplica o filtro de sentido e decide avisos e beep. Lógica pura, coberta por testes em Node.
4. **Segundo plano** (`src/background.js`): registra a task do Foreground Service (importada em `index.js` antes do App, necessário no modo headless).
5. **Interface** (`App.js`): status do serviço, estados, bases instaladas, opções e testes.

## Estrutura

```
App.js                      UI (serviço, estados, opções, testes)
index.js                    entrada; registra a task antes do App
src/database.js             config, download, sha256, descompactação, SQLite
src/detector.js             busca de radares, filtro de sentido, avisos e beep
src/background.js           Foreground Service (expo-location + task-manager)
modules/kradar-zstd/        módulo nativo: zstd em streaming, sha256 de arquivo, beep
plugins/withPickFirst.js    config plugin: libs .so duplicadas, ABIs ARM, regras ProGuard
test/detector.test.mjs      testes da lógica
```

## Stack e compatibilidade

- Expo SDK 48 / React Native 0.71 (a última linha que suporta **minSdk 21**, Android 5.0).
- APK só com ABIs ARM (`armeabi-v7a`, `arm64-v8a`), com R8 e shrink de recursos ligados (~14 MB).

## Build do APK

Requisitos: Node 18+, **JDK 11** e Android SDK (`platforms;android-34`, `build-tools;34.0.0`; o Gradle baixa NDK/CMake sozinho).

```bash
npm install --legacy-peer-deps
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
```

O APK sai em `android/app/build/outputs/apk/release/app-release.apk` (assinado com a chave de debug do template; use seu keystore para distribuir).

Pontos que deram problema no Windows:

- **Use JDK 11.** Com o JDK 17 o Gradle 7.5 falha com `Unable to establish loopback connection`.
- **Caminho do projeto sem espaços.** `gradlew.bat` quebra em pastas como `C:\Repos Personal`; use uma junção (`mklink /J C:\kradar "C:\Repos Personal\KRadarDetector"`) e compile por ela.
- A pasta `android/` é gerada pelo `prebuild` e não vai para o git. Os ajustes nativos (libs duplicadas, ABIs, ProGuard) vêm do plugin `plugins/withPickFirst.js`.

Alternativa sem Java local: `npx eas build -p android --profile preview`.

## Testes

```bash
node --no-warnings test/detector.test.mjs
```

## Observações

- O Pardal só anexa o `.sqlite.zst` às releases a partir da seguinte a `dados-2026-11-10`; antes disso o download retorna erro.
- Em multimídias que matam serviços em segundo plano, desative a otimização de bateria do app.
- O R8 ofusca classes que o Expo instancia por reflexão; as regras de keep estão no plugin. Se aparecer erro de "task consumer", verifique essas regras.

## Dados e licença

Dados © colaboradores do OpenStreetMap, licença [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), via [Pardal](https://github.com/Murkiriel/pardal). As bases não estão neste repositório; são baixadas pelo app.
