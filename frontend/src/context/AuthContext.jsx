import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getApiError,
  getCurrentUser,
  googleLoginUser,
  loginUser,
  logoutUser,
  setAuthToken,
  signupUser,
} from '../services/api'
import { signInWithGooglePopup, signOutFromFirebase } from '../services/firebase'
import { AuthContext } from './auth-context'

const TOKEN_KEY = 'nasa_agent_token'
const USER_KEY = 'nasa_agent_user'

function readJson(key) {
  try {
    const value = localStorage.getItem(key)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY))
  const [user, setUser] = useState(() => readJson(USER_KEY))
  const [booting, setBooting] = useState(true)

  const clearSession = useCallback(() => {
    setToken(null)
    setUser(null)
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setAuthToken(null)
  }, [])

  const persistSession = useCallback((authPayload) => {
    setToken(authPayload.access_token)
    setUser(authPayload.user)
    localStorage.setItem(TOKEN_KEY, authPayload.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(authPayload.user))
    setAuthToken(authPayload.access_token)
  }, [])

  useEffect(() => {
    let isMounted = true

    async function bootstrapSession() {
      if (!token) {
        setBooting(false)
        return
      }

      setAuthToken(token)

      try {
        const profile = await getCurrentUser()
        if (!isMounted) return
        setUser(profile)
        localStorage.setItem(USER_KEY, JSON.stringify(profile))
      } catch {
        if (isMounted) {
          clearSession()
        }
      } finally {
        if (isMounted) {
          setBooting(false)
        }
      }
    }

    bootstrapSession()

    return () => {
      isMounted = false
    }
  }, [clearSession, token])

  const login = useCallback(
    async ({ username, password }) => {
      try {
        const payload = await loginUser({ username, password })
        persistSession(payload)
        return payload
      } catch (error) {
        throw new Error(getApiError(error, 'Login failed. Check your credentials.'), {
          cause: error,
        })
      }
    },
    [persistSession],
  )

  const signup = useCallback(
    async ({ username, email, password }) => {
      try {
        await signupUser({ username, email, password })
        return login({ username, password })
      } catch (error) {
        throw new Error(getApiError(error, 'Signup failed. Please check your details.'), {
          cause: error,
        })
      }
    },
    [login],
  )

  const loginWithGoogle = useCallback(async () => {
    try {
      const firebaseUser = await signInWithGooglePopup()
      const idToken = await firebaseUser.getIdToken()
      const payload = await googleLoginUser(idToken)
      persistSession(payload)
      return payload
    } catch (error) {
      throw new Error(error.message || 'Google sign-in failed.', { cause: error })
    }
  }, [persistSession])

  const logout = useCallback(async () => {
    try {
      if (token) {
        await logoutUser()
      }
    } catch {
      // Client-side token removal is still the important step for stateless JWT logout.
    } finally {
      await signOutFromFirebase().catch(() => {})
      clearSession()
    }
  }, [clearSession, token])

  const value = useMemo(
    () => ({
      user,
      token,
      booting,
      isAuthenticated: Boolean(token && user),
      login,
      signup,
      loginWithGoogle,
      logout,
    }),
    [booting, login, loginWithGoogle, logout, signup, token, user],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
