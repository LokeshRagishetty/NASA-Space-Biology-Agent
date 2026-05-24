import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider,
  getAuth,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
}

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
)

const app = isFirebaseConfigured ? initializeApp(firebaseConfig) : null
export const firebaseAuth = app ? getAuth(app) : null
export const googleProvider = new GoogleAuthProvider()

googleProvider.setCustomParameters({
  prompt: 'select_account',
})

export async function signInWithGooglePopup() {
  if (!firebaseAuth) {
    throw new Error('Firebase is not configured. Add the VITE_FIREBASE_* values to frontend/.env.')
  }

  const result = await signInWithPopup(firebaseAuth, googleProvider)
  return result.user
}

export async function signOutFromFirebase() {
  if (firebaseAuth) {
    await signOut(firebaseAuth)
  }
}

export async function sendFirebasePasswordReset(email) {
  if (!firebaseAuth) {
    throw new Error('Firebase password reset is not configured for this frontend.')
  }

  await sendPasswordResetEmail(firebaseAuth, email)
}
