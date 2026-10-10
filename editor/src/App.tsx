import { NodeEditor } from './editor/NodeEditor';
import { Fm1SupportPage } from './editor/Fm1SupportPage';

export function App() {
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname === '/fm1-support' || params.get('view') === 'fm1-support') {
    return <Fm1SupportPage />;
  }
  return <NodeEditor />;
}
