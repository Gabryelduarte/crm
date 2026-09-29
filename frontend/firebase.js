import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAnalytics } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBkmw6u-bgsLALfidTsCjG29k0Q-XHZC5s',
  authDomain: 'mlgestao.firebaseapp.com',
  projectId: 'mlgestao',
  storageBucket: 'mlgestao.firebasestorage.app',
  messagingSenderId: '103856650124',
  appId: '1:103856650124:web:9f3bf98960b4003fd508a9',
  measurementId: 'G-79ZKPEB2RW'
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const auth = getAuth(app);

export { analytics, app, auth };