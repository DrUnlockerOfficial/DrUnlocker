
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getDatabase, ref, set, get } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-database.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  updateProfile,
  signOut
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyCwAX2A35nYps1T4f30_lurNh_7SzL8by8",
  authDomain: "dr-unlocker.firebaseapp.com",
  projectId: "dr-unlocker",
  storageBucket: "dr-unlocker.firebasestorage.app",
  messagingSenderId: "783882145882",
  appId: "1:783882145882:web:64f34098b501f6e9da8863",
  measurementId: "G-HTC5C0F929",
  databaseURL: "https://dr-unlocker-default-rtdb.firebaseio.com/"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

await setPersistence(auth, browserLocalPersistence);

const page = document.body.dataset.page || "index";
const messageBoxFrame = document.getElementById("messageBoxFrame");

function showMessageBox(message, title = "Message", variant = "warning", subtitle = "Please review the following message.") {
  if (!messageBoxFrame || !messageBoxFrame.contentWindow) return;
  messageBoxFrame.style.display = "block";
  messageBoxFrame.contentWindow.postMessage({
    type: "MB_SHOW",
    payload: { title, message, subtitle, variant }
  }, "*");
}

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "MB_CLOSED") {
    if (messageBoxFrame) {
      messageBoxFrame.style.display = "none";
    }
  }
});

function normalizeUsername(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function addDuration(baseMs, amount, unit) {
  const ms = {
    minute: 60 * 1000,
    minutes: 60 * 1000,
    min: 60 * 1000,
    mins: 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    months: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
    years: 365 * 24 * 60 * 60 * 1000
  };
  return baseMs + (Number(amount) || 0) * (ms[unit] || 0);
}

function parsePeriod(period, frozenAt) {
  if (!period) return null;

  if (typeof period === "number") {
    return addDuration(frozenAt, period, "days");
  }

  if (typeof period === "string") {
    const text = period.trim().toLowerCase();
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(minute|minutes|min|mins|hour|hours|day|days|month|months|year|years)$/i);
    if (match) {
      return addDuration(frozenAt, Number(match[1]), match[2].toLowerCase());
    }
    return null;
  }

  if (typeof period === "object") {
    const amount = Number(period.value ?? period.amount ?? period.number);
    const unit = String(period.unit ?? period.type ?? "days").toLowerCase();
    if (!Number.isFinite(amount)) return null;
    return addDuration(frozenAt, amount, unit);
  }

  return null;
}

function formatPeriodLabel(period) {
  if (!period) return "";
  if (typeof period === "number") return `${period} day${period === 1 ? "" : "s"}`;
  if (typeof period === "string") return period.trim();
  if (typeof period === "object") {
    const value = period.value ?? period.amount ?? period.number;
    const unit = String(period.unit ?? period.type ?? "days").toLowerCase();
    if (value == null || value === "") return "";
    return `${value} ${unit}`;
  }
  return "";
}

function getFreezeUntil(user) {
  if (!user) return null;
  if (user.freezeUntil) {
    const ts = Number(user.freezeUntil);
    if (Number.isFinite(ts)) return ts;
  }
  const frozenAt = Number(user.frozenAt || user.freezeStartedAt || 0);
  if (!frozenAt) return null;
  return parsePeriod(user.period, frozenAt);
}

function getFreezeMessage(user) {
  const duration = formatPeriodLabel(user?.period || user?.freezeDuration || user?.freezePeriod);
  const freezeUntil = getFreezeUntil(user);

  if (duration) {
    if (freezeUntil) {
      return `Your account is frozen for ${duration}.\nUnlock time: ${new Date(freezeUntil).toLocaleString("en-US")}.`;
    }
    return `Your account is frozen for ${duration}.`;
  }

  if (freezeUntil) {
    return `Your account is frozen for the specified duration.\nUnlock time: ${new Date(freezeUntil).toLocaleString("en-US")}.`;
  }

  return `Your account is frozen for the specified duration.`;
}

function checkAccountStatus(user) {
  const status = normalizeStatus(user?.accountStatus);

  if (status === "banned") {
    return { allowed: false, message: "Your account is banned." };
  }

  if (status === "freezed") {
    return { allowed: false, message: getFreezeMessage(user) };
  }

  return { allowed: true, message: "" };
}

async function getUserRecordByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;

  const snap = await get(ref(db, "users"));
  const users = snap.val() || {};

  for (const key of Object.keys(users)) {
    const user = users[key];
    if (normalizeEmail(user?.email) === normalized) {
      return { key, ...user };
    }
  }

  return null;
}

async function getUserRecordByUid(uid) {
  if (!uid) return null;
  const snap = await get(ref(db, `users/${uid}`));
  if (snap.exists()) {
    return { key: uid, ...snap.val() };
  }
  return null;
}

async function getCurrentUserRecord() {
  const user = auth.currentUser;
  if (!user) return null;
  return (await getUserRecordByUid(user.uid)) || (await getUserRecordByEmail(user.email));
}

async function ensureAuthAllowedOrRedirect() {
  await auth.authStateReady();

  const user = auth.currentUser;
  if (!user) {
    if (page !== "index") {
      window.location.replace("index.html");
    }
    return null;
  }

  const record = await getCurrentUserRecord();
  const gate = checkAccountStatus(record);

  if (!gate.allowed) {
    await signOut(auth);
    showMessageBox(gate.message, "Access denied", "warning");
    window.location.replace("index.html?logout=1");
    return null;
  }

  return { user, record };
}

function setActiveNav(pageName) {
  document.querySelectorAll(".nav-btn").forEach((el) => {
    if (el.dataset.page) {
      el.classList.toggle("active", el.dataset.page === pageName);
    }
  });
}

function formatBalance(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function emailExistsInRTDB(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const snap = await get(ref(db, "users"));
  const users = snap.val() || {};
  return Object.values(users).some(user => normalizeEmail(user?.email || "") === normalized);
}

async function buildUniqueUsername(baseUsername) {
  const snap = await get(ref(db, "users"));
  const users = snap.val() || {};
  const taken = new Set(
    Object.values(users)
      .map(user => String(user?.username || "").toLowerCase())
      .filter(Boolean)
  );

  let candidate = baseUsername || "user";
  let counter = 2;

  while (taken.has(candidate)) {
    candidate = `${baseUsername || "user"}${counter}`;
    counter += 1;
  }

  return candidate;
}

function initNav() {
  setActiveNav(page);
}

async function initIndexPage() {
  await auth.authStateReady();
  const current = auth.currentUser;
  if (current) {
    const record = await getCurrentUserRecord();
    const gate = checkAccountStatus(record);

    if (gate.allowed) {
      window.location.replace("home.html");
      return;
    }

    await signOut(auth);
    showMessageBox(gate.message, "Access denied", "warning");
  }

  const tabSignin = document.getElementById("tabSignin");
  const tabSignup = document.getElementById("tabSignup");
  const signinView = document.getElementById("signinView");
  const signupView = document.getElementById("signupView");
  const signinBtn = document.getElementById("signinBtn");
  const saveAllBtn = document.getElementById("saveAllBtn");
  const goSignupBtn = document.getElementById("goSignupBtn");
  const goSigninBtn = document.getElementById("goSigninBtn");
  const userKeyInput = document.getElementById("userKey");
  const usernameInput = document.getElementById("username");
  const emailInput = document.getElementById("email");

  let usernameCheckToken = 0;
  let emailCheckToken = 0;

  function getSignupData() {
    const fullName = userKeyInput.value.trim();
    const username = normalizeUsername(fullName);
    const email = normalizeEmail(emailInput.value);

    return {
      fullName,
      username,
      email,
      password: document.getElementById("password").value,
      accountStatus: "Idle"
    };
  }

  function getSigninData() {
    return {
      email: document.getElementById("signinEmail").value.trim(),
      password: document.getElementById("signinPassword").value
    };
  }

  async function updateUsernameField() {
    const token = ++usernameCheckToken;
    const baseUsername = normalizeUsername(userKeyInput.value);
    usernameInput.value = baseUsername;

    if (!baseUsername) return;

    try {
      const uniqueUsername = await buildUniqueUsername(baseUsername);
      if (token !== usernameCheckToken) return;
      usernameInput.value = uniqueUsername;
    } catch {
      if (token !== usernameCheckToken) return;
      usernameInput.value = baseUsername;
    }
  }

  async function updateEmailFieldValidity() {
    const token = ++emailCheckToken;
    const email = normalizeEmail(emailInput.value);

    emailInput.setCustomValidity("");
    if (!email) return;

    try {
      const exists = await emailExistsInRTDB(email);
      if (token !== emailCheckToken) return;
      if (exists) {
        emailInput.setCustomValidity("This email is already used in the database");
      }
    } catch {
      if (token !== emailCheckToken) return;
    }
  }

  function showSignin() {
    signinView.classList.remove("hidden");
    signupView.classList.add("hidden");
    tabSignin.classList.add("active");
    tabSignup.classList.remove("active");
  }

  function showSignup() {
    signinView.classList.add("hidden");
    signupView.classList.remove("hidden");
    tabSignin.classList.remove("active");
    tabSignup.classList.add("active");
  }

  tabSignin?.addEventListener("click", showSignin);
  tabSignup?.addEventListener("click", showSignup);
  goSignupBtn?.addEventListener("click", showSignup);
  goSigninBtn?.addEventListener("click", showSignin);
  userKeyInput?.addEventListener("input", updateUsernameField);
  emailInput?.addEventListener("input", updateEmailFieldValidity);

  async function saveToRealtimeDatabase(authUser) {
    const { fullName, username, email, accountStatus } = getSignupData();

    if (!fullName) throw new Error("Full Name is empty");
    if (!email) throw new Error("Email Address is empty");

    const emailTaken = await emailExistsInRTDB(email);
    if (emailTaken) {
      emailInput.reportValidity();
      throw new Error("This email is already used in the database");
    }

    const uniqueUsername = await buildUniqueUsername(username);
    usernameInput.value = uniqueUsername;

    await set(ref(db, `users/${authUser.uid}`), {
      uid: authUser.uid,
      fullName,
      username: uniqueUsername,
      email,
      balance: 0,
      registeredAt: new Date().toLocaleString("en-US", { dateStyle: "full", timeStyle: "medium" }),
      accountStatus
    });
  }

  async function saveToAuth() {
    const { username, email, password } = getSignupData();

    if (!email || !password) {
      throw new Error("Email and Password are required for Auth");
    }

    const methods = await fetchSignInMethodsForEmail(auth, email);
    if (methods.length > 0) {
      throw new Error("This email is already used in Auth");
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(cred.user, {
      displayName: username || email.split("@")[0]
    });

    await saveToRealtimeDatabase(cred.user);
    window.location.replace("home.html");
  }

  async function signInUser() {
    const { email, password } = getSigninData();

    if (!email || !password) {
      throw new Error("Email and Password are required for SignIn");
    }

    const cred = await signInWithEmailAndPassword(auth, email, password);
    const userRecord = (await getUserRecordByUid(cred.user.uid)) || (await getUserRecordByEmail(cred.user.email));
    const gate = checkAccountStatus(userRecord);

    if (!gate.allowed) {
      await signOut(auth);
      showMessageBox(gate.message, "Access denied", "warning");
      return;
    }

    window.location.replace("home.html");
  }

  await updateUsernameField();

  saveAllBtn?.addEventListener("click", async () => {
    try {
      await saveToAuth();
    } catch (error) {
      showMessageBox(error.message || String(error), "Signup failed", "warning");
    }
  });

  signinBtn?.addEventListener("click", async () => {
    try {
      await signInUser();
    } catch (error) {
      showMessageBox(error.message || String(error), "SignIn failed", "warning");
    }
  });

  initNav();
}

async function initProtectedPage() {
  const state = await ensureAuthAllowedOrRedirect();
  if (!state) return;

  initNav();

  const welcomeTitle = document.getElementById("welcomeTitle");
  const welcomeSubtitle = document.getElementById("welcomeSubtitle");
  const balanceText = document.getElementById("balanceText");
  const emailText = document.getElementById("emailText");
  const uidText = document.getElementById("uidText");
  const logoutBtn = document.getElementById("logoutBtn");

  const user = state.user;
  const record = state.record || {};

  const username = user.displayName || (user.email ? user.email.split("@")[0] : "-");

  if (page === "home") {
    if (welcomeTitle) welcomeTitle.textContent = `Welcome, ${username}`;
    if (welcomeSubtitle) welcomeSubtitle.textContent = "Your account is ready and your session is active.";
    if (balanceText) balanceText.textContent = formatBalance(record.balance ?? 0);
  }

  if (page === "profile") {
    if (welcomeTitle) welcomeTitle.textContent = "Profile";
    if (welcomeSubtitle) welcomeSubtitle.textContent = `Welcome, ${username}`;
    if (balanceText) balanceText.textContent = formatBalance(record.balance ?? 0);
    if (emailText) emailText.textContent = user.email || "-";
    if (uidText) uidText.textContent = user.uid || "-";
    if (logoutBtn) {
      logoutBtn.addEventListener("click", async () => {
        await signOut(auth);
        window.location.replace("index.html?logout=1");
      });
    }
  }
}

function initStaticPage() {
  initNav();
}

switch (page) {
  case "index":
    initIndexPage();
    break;
  case "home":
  case "profile":
    initProtectedPage();
    break;
  case "order":
  case "about":
    initStaticPage();
    break;
  default:
    initStaticPage();
    break;
}
