import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import 'vidstack/styles/base.css';
import 'vidstack/styles/defaults.css';
import 'vidstack/styles/community-skin/video.css';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
