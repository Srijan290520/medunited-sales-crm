import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import '../css/styles.css';

// Refuse to run inside someone else's frame (clickjacking). Hosts that can
// send headers also set frame-ancestors / X-Frame-Options (see deploy/);
// this covers hosts that can't, like GitHub Pages.
if (window.top !== window.self && import.meta.env.VITE_DEMO !== 'true') {
  document.body.innerHTML = '';
  try {
    window.top!.location.href = window.self.location.href;
  } catch {
    /* cross-origin parent: leave the page blank */
  }
} else {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
