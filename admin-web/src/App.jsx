import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import ToastContainer from './components/ToastContainer';
import AppRouter from './router/index';
import './index.css';

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <WebSocketProvider>
          <AppRouter />
        </WebSocketProvider>
        <ToastContainer />
      </ToastProvider>
    </AuthProvider>
  );
}
