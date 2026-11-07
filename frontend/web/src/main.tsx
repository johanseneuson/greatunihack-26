import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/tokens.css'
import './styles/app.css'

// Apply saved theme before first paint
try {
  const t = localStorage.getItem('fb.theme')
  if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark')
} catch { /* storage unavailable */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
