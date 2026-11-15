import { registerRootComponent } from 'expo';
import './src/background'; // registra a task ANTES do App (necessário no modo headless)
import { logError } from './src/errorlog';
import React from 'react';
import App from './App';
import ErrorBoundary from './src/ErrorBoundary';

// Um erro de JS não deve derrubar/reiniciar o app (e o serviço em segundo plano):
// registra em arquivo (mostrado no app) e segue. Em desenvolvimento, mantém o comportamento padrão.
const eu = global.ErrorUtils;
if (eu && !__DEV__) {
  eu.setGlobalHandler((e, isFatal) => {
    logError(isFatal ? 'fatal' : 'js', e);
  });
}

registerRootComponent(() => React.createElement(ErrorBoundary, null, React.createElement(App)));
