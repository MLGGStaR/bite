/* Bite · cloud.js — Firebase auth + Firestore sync (ES module).
   Exposes window.Cloud; fires "cloud-auth" once the auth state is known.
   If this module fails to load (offline first launch), the app runs local-only. */

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, getDocs, writeBatch, deleteDoc,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";

const app = initializeApp({
  apiKey: "AIzaSyCw14vNb73mCIUC-LTbEBwYsxqLoT-0s9k",
  authDomain: "bite-8c257.firebaseapp.com",
  projectId: "bite-8c257",
  storageBucket: "bite-8c257.firebasestorage.app",
  messagingSenderId: "900054108962",
  appId: "1:900054108962:web:0dd57ea35c3ed50250f37b",
});

const auth = getAuth(app);
const db = getFirestore(app);

/* Firestore rejects `undefined` values — a JSON round-trip strips them. */
const clean = o => JSON.parse(JSON.stringify(o));

const Cloud = {
  user: null,
  ready: false,

  async create(email, pw) {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    this.user = cred.user;
    return cred.user;
  },

  async signIn(email, pw) {
    const cred = await signInWithEmailAndPassword(auth, email, pw);
    this.user = cred.user;
    return cred.user;
  },

  async resetPassword(email) {
    await sendPasswordResetEmail(auth, email);
  },

  async signOutUser() {
    await signOut(auth);
    this.user = null;
  },

  /* ---- data ---- */

  rootRef() { return doc(db, "users", this.user.uid); },
  dayRef(k) { return doc(db, "users", this.user.uid, "days", k); },

  async pullRoot() {
    const snap = await getDoc(this.rootRef());
    return snap.exists() ? snap.data() : null;
  },

  async pullDays() {
    const snap = await getDocs(collection(db, "users", this.user.uid, "days"));
    const days = {};
    snap.forEach(d => { days[d.id] = d.data(); });
    return days;
  },

  async pushRoot(profile, favs, weights, updatedAt) {
    await setDoc(this.rootRef(), clean({ profile, favs, weights, updatedAt }));
  },

  async pushDays(daysMap) {
    const keys = Object.keys(daysMap);
    for (let i = 0; i < keys.length; i += 400) {
      const batch = writeBatch(db);
      for (const k of keys.slice(i, i + 400)) {
        batch.set(this.dayRef(k), clean(daysMap[k]));
      }
      await batch.commit();
    }
  },

  async deleteDay(k) {
    await deleteDoc(this.dayRef(k));
  },

  friendlyError(e) {
    const c = e?.code || "";
    if (c.includes("configuration-not-found") || c.includes("operation-not-allowed"))
      return "Accounts aren't switched on yet — enable Email/Password sign-in in the Firebase console.";
    if (c.includes("email-already-in-use")) return "That email already has an account — tap Sign in instead.";
    if (c.includes("invalid-email")) return "That email doesn't look right.";
    if (c.includes("weak-password")) return "Password needs at least 6 characters.";
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
      return "Email or password is wrong.";
    if (c.includes("too-many-requests")) return "Too many tries — wait a minute and try again.";
    if (c.includes("network-request-failed")) return "No connection — try again when you're online.";
    if (c.includes("permission-denied")) return "Cloud sync isn't enabled yet.";
    return e?.message?.replace(/^Firebase:\s*/, "").replace(/\s*\(auth.*\)\.?$/, "") || "Something went wrong.";
  },
};

window.Cloud = Cloud;

onAuthStateChanged(auth, u => {
  Cloud.user = u;
  Cloud.ready = true;
  window.dispatchEvent(new CustomEvent("cloud-auth", { detail: u }));
});
