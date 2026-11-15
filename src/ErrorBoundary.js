import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { logError } from './errorlog';

/** Erro de renderização não deixa a tela em branco: mostra o erro e permite tentar de novo. */
export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    logError('render', error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{ flex: 1, backgroundColor: '#000', padding: 20, justifyContent: 'center' }}>
        <Text style={{ color: '#f87171', fontSize: 16 }}>Erro na tela: {String(this.state.error.message || this.state.error)}</Text>
        <Pressable
          style={{ backgroundColor: '#2563eb', padding: 14, borderRadius: 8, marginTop: 16, alignItems: 'center' }}
          onPress={() => this.setState({ error: null })}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }
}
