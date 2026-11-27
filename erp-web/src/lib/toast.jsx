import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const notify = useCallback((msg, kind = 'error') => setToast({ msg, kind, id: Date.now() }), [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), toast.kind === 'error' ? 4000 : 2800)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast ${toast.kind}`} role="status">
          {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
