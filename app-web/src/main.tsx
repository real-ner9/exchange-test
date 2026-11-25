import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { ThemeProvider, Toaster, ToasterComponent, ToasterProvider } from '@gravity-ui/uikit'
import '@gravity-ui/uikit/styles/fonts.css'
import '@gravity-ui/uikit/styles/styles.css'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './auth.tsx'

const toaster = new Toaster()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider theme="light">
      <ToasterProvider toaster={toaster}>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
        <ToasterComponent />
      </ToasterProvider>
    </ThemeProvider>
  </StrictMode>,
)
