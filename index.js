import { registerRootComponent } from 'expo';
import './src/background'; // registra a task ANTES do App (necessário no modo headless)
import App from './App';

registerRootComponent(App);
