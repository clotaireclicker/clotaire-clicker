(() => {
  const accountButton = document.querySelector('#account-button');
  const profileButton = document.querySelector('#account-profile');
  const dialog = document.querySelector('#account-dialog');
  const form = document.querySelector('#account-form');
  const modeTitle = document.querySelector('#account-mode-title');
  const usernameField = document.querySelector('#username-field');
  const usernameInput = document.querySelector('#account-username');
  const emailInput = document.querySelector('#account-email');
  const passwordInput = document.querySelector('#account-password');
  const formMessage = document.querySelector('#account-message');
  const modeSwitch = document.querySelector('#account-mode-switch');
  const status = document.querySelector('#save-status');
  const guestKey = 'clotaire-save-guest';
  const defaults = () => ({ coins: 0, total: 0, click: 1, perSec: 0, owned: { sceptre: 0, page: 0, cheval: 0, village: 0, clicRoyal: 0, pluieOr: 0 } });
  let auth = null, db = null, activeUser = null, cloudTimer = null, mode = 'signin';
  const originalSave = save;

  function say(message, online = false) {
    status.textContent = message;
    status.dataset.online = online ? 'true' : 'false';
  }

  function cleanSave(raw) {
    const base = defaults();
    if (!raw || typeof raw !== 'object') return base;
    const number = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
    const counts = raw.owned && typeof raw.owned === 'object' ? raw.owned : {};
    const owned = {
        sceptre: Math.floor(number(counts.sceptre, 0)), page: Math.floor(number(counts.page, 0)),
        cheval: Math.floor(number(counts.cheval, 0)), village: Math.floor(number(counts.village, 0)),
        clicRoyal: Math.floor(number(counts.clicRoyal, 0)), pluieOr: Math.floor(number(counts.pluieOr, 0)),
    };
    return {
      coins: number(raw.coins, 0), total: number(raw.total, 0),
      click: 1 + owned.sceptre + 5 * owned.cheval + 12 * owned.clicRoyal,
      perSec: owned.page + 12 * owned.village + 5 * owned.pluieOr,
      owned,
    };
  }

  function localSave(key) {
    try { return cleanSave(JSON.parse(localStorage.getItem(key) || 'null')); }
    catch { return defaults(); }
  }

  function accountKey(uid) { return 'clotaire-save-' + uid; }

  async function persistCloud(user = activeUser) {
    if (!user || !db) return;
    const snapshot = { ...cleanSave(state), savedAt: Date.now() };
    try {
      await window.firebaseModules.set(window.firebaseModules.ref(db, `users/${user.uid}`), { game: snapshot, updatedAt: Date.now() });
      if (activeUser && activeUser.uid === user.uid) say('Partie synchronisée avec le compte', true);
    } catch (error) {
      if (activeUser && activeUser.uid === user.uid) say('Sauvegarde locale — synchronisation à réessayer');
      console.error(error);
    }
  }

  function queueCloudSave() {
    if (!activeUser || cloudTimer) return;
    cloudTimer = setTimeout(() => { cloudTimer = null; persistCloud(activeUser); }, 5000);
  }

  save = function () {
    originalSave();
    if (activeUser) {
      localStorage.setItem(accountKey(activeUser.uid), JSON.stringify(state));
      queueCloudSave();
    }
  };

  function showUser(user) {
    if (user) {
      accountButton.hidden = true;
      profileButton.hidden = false;
      profileButton.textContent = `👤 ${user.displayName || user.email}`;
    } else {
      accountButton.hidden = false;
      profileButton.hidden = true;
    }
  }

  async function applyUser(user) {
    const previous = activeUser;
    activeUser = user || null;
    if (!user) {
      if (previous) {
        state = localSave(guestKey);
        render();
        originalSave();
      }
      showUser(null);
      say('Progression sauvegardée sur cet appareil');
      return;
    }
    showUser(user);
    if (previous && previous.uid === user.uid) return;
    say('Chargement de la partie…');
    const userRef = window.firebaseModules.ref(db, `users/${user.uid}`);
    try {
      const remote = await window.firebaseModules.get(userRef);
      const remoteData = remote.exists() ? remote.val() : null;
      if (remoteData && remoteData.game) {
        state = cleanSave(remoteData.game);
      } else {
        const saved = localStorage.getItem(accountKey(user.uid)) || localStorage.getItem(guestKey) || localStorage.getItem('clotaire-save');
        state = saved ? cleanSave(JSON.parse(saved)) : defaults();
      }
      localStorage.setItem(accountKey(user.uid), JSON.stringify(state));
      render();
      originalSave();
      if (remoteData && remoteData.game) say('Partie synchronisée avec le compte', true);
      else { say('Sauvegarde du compte en cours…'); await persistCloud(user); }
    } catch (error) {
      say('Compte connecté — sauvegarde en ligne indisponible');
      console.error(error);
    }
  }

  function explainError(error) {
    const messages = {
      'auth/email-already-in-use': 'Cette adresse e-mail a déjà un compte. Connecte-toi plutôt.',
      'auth/invalid-email': 'Cette adresse e-mail ne semble pas valide.',
      'auth/weak-password': 'Choisis un mot de passe d’au moins 6 caractères.',
      'auth/invalid-api-key': 'Clé Firebase incorrecte. La configuration du projet doit être recopiée.',
      'auth/app-not-authorized': 'Firebase refuse ce site. Vérifie le domaine autorisé et les restrictions de la clé API.',
      'auth/unauthorized-domain': 'Ajoute clotaireclicker.netlify.app aux domaines autorisés dans les paramètres Firebase Authentication.',
      'auth/network-request-failed': 'Connexion à Firebase impossible. Vérifie ta connexion Internet et réessaie.',
      'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
      'auth/user-not-found': 'Aucun compte trouvé avec cette adresse e-mail.',
      'auth/wrong-password': 'Mot de passe incorrect.',
      'auth/too-many-requests': 'Trop d’essais. Réessaie un peu plus tard.',
      'auth/operation-not-allowed': 'Active la connexion e-mail/mot de passe dans Firebase.',
      'PERMISSION_DENIED': 'Les règles de la base Firebase doivent encore être configurées.',
    };
    return messages[error.code] || `Erreur Firebase : ${error.code || error.message || 'code indisponible'}.`;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const signingUp = mode === 'signup';
    modeTitle.textContent = signingUp ? 'Créer un compte' : 'Se connecter';
    usernameField.hidden = !signingUp;
    usernameInput.required = signingUp;
    passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
    form.querySelector('[type="submit"]').textContent = signingUp ? 'Créer mon compte' : 'Connexion';
    modeSwitch.textContent = signingUp ? 'J’ai déjà un compte' : 'Créer un compte';
    document.querySelector('#reset-password').hidden = signingUp;
    formMessage.textContent = '';
  }

  accountButton.addEventListener('click', () => {
    if (!window.CLOTAIRE_FIREBASE_CONFIG || !window.CLOTAIRE_FIREBASE_CONFIG.apiKey) {
      alert('Le compte gratuit doit encore être relié à Firebase. Suis le petit guide de configuration.');
      return;
    }
    setMode('signin');
    dialog.showModal();
  });
  profileButton.addEventListener('click', async () => {
    if (auth && auth.currentUser && confirm('Se déconnecter ?')) await window.firebaseModules.signOut(auth);
  });
  document.querySelector('#account-close').addEventListener('click', () => dialog.close());
  modeSwitch.addEventListener('click', () => setMode(mode === 'signup' ? 'signin' : 'signup'));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    formMessage.textContent = 'Un instant…';
    try {
      if (mode === 'signup') {
        const username = usernameInput.value.trim();
        const result = await window.firebaseModules.createUserWithEmailAndPassword(auth, email, password);
        await window.firebaseModules.updateProfile(result.user, { displayName: username });
        showUser(result.user);
        await applyUser(result.user);
        dialog.close();
      } else {
        const result = await window.firebaseModules.signInWithEmailAndPassword(auth, email, password);
        await applyUser(result.user);
        dialog.close();
      }
    } catch (error) {
      formMessage.textContent = explainError(error);
      console.error(error);
    } finally { submit.disabled = false; }
  });

  document.querySelector('#reset-password').addEventListener('click', async () => {
    const email = emailInput.value.trim();
    if (!email) { formMessage.textContent = 'Saisis ton e-mail pour recevoir le lien de réinitialisation.'; return; }
    try {
      await window.firebaseModules.sendPasswordResetEmail(auth, email);
      formMessage.textContent = 'Lien de réinitialisation envoyé par e-mail.';
    } catch (error) { formMessage.textContent = explainError(error); }
  });

  window.redeemGlobalGameCode = async (code) => {
    const normalized = String(code).trim().toLowerCase();
    const offers = { liamlegoat: 45000000, iamthebest89: 100000000 };
    const reward = offers[normalized];
    if (!reward) return 'invalid';
    if (!auth || !auth.currentUser || !db || !window.firebaseModules) return 'login';
    try {
      const claimRef = window.firebaseModules.ref(db, `redeemedCodes/${normalized}`);
      const uid = auth.currentUser.uid;
      const result = await window.firebaseModules.runTransaction(claimRef, current => current === null ? uid : undefined);
      if (!result.committed) return 'used';
      state.coins += reward;
      state.total += reward;
      render();
      save();
      return 'success';
    } catch (error) {
      console.error(error);
      return 'error';
    }
  };
  window.addEventListener('pagehide', () => {
    if (cloudTimer && activeUser) {
      clearTimeout(cloudTimer);
      cloudTimer = null;
      persistCloud(activeUser);
    }
  });

  async function initialize() {
    const config = window.CLOTAIRE_FIREBASE_CONFIG || {};
    if (!config.apiKey || !config.projectId || !config.appId || !config.databaseURL) {
      say('Progression locale — compte en attente de configuration');
      return;
    }
    try {
      const version = '12.19.0';
      const [appModule, authModule, databaseModule] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
        import(`https://www.gstatic.com/firebasejs/${version}/firebase-database.js`),
      ]);
      const app = appModule.initializeApp(config);
      auth = authModule.getAuth(app);
      db = databaseModule.getDatabase(app, config.databaseURL);
      window.firebaseModules = { ...authModule, ...databaseModule };
      authModule.onAuthStateChanged(auth, applyUser);
    } catch (error) {
      say('Connexion indisponible — vérifie la configuration Firebase');
      console.error(error);
    }
  }

  initialize();
})();
