(function () {
  var ACCOUNTS_KEY = "pokerlife.accounts";
  var SESSION_KEY = "pokerlife.session";
  var STARTING_MONEY = 500;

  function pageName() {
    var name = location.pathname.split("/").pop();
    return name || "index.html";
  }

  function isLoginPage() {
    return pageName() === "login.html";
  }

  function safeNext(value) {
    if (typeof value !== "string") return "index.html";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(value)) return "index.html";
    if (value.toLowerCase() === "login.html") return "index.html";
    return value;
  }

  function destination() {
    var params = new URLSearchParams(location.search);
    return safeNext(params.get("next"));
  }

  function readAccounts() {
    try {
      var parsed = JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function currentUser() {
    try {
      var name = sessionStorage.getItem(SESSION_KEY);
      return name && name.trim() ? name : null;
    } catch (error) {
      return null;
    }
  }

  function findAccount(username) {
    var key = username.trim().toLowerCase();
    if (!key) return null;
    var accounts = readAccounts();
    for (var i = 0; i < accounts.length; i += 1) {
      var account = accounts[i];
      if (!account || typeof account.username !== "string") continue;
      if (account.username.toLowerCase() === key) return account;
    }
    return null;
  }

  function remember(username) {
    sessionStorage.setItem(SESSION_KEY, username);
    location.replace(destination());
  }

  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (error) {}

  function endVisitIfLeaving(url) {
    try {
      if (new URL(url, location.href).origin !== location.origin) {
        sessionStorage.removeItem(SESSION_KEY);
      }
    } catch (error) {}
  }

  if (window.navigation && typeof navigation.addEventListener === "function") {
    navigation.addEventListener("navigate", function (event) {
      var destinationUrl = event.destination && event.destination.url;
      if (destinationUrl) endVisitIfLeaving(destinationUrl);
    });
  }

  window.addEventListener("pageshow", function (event) {
    if (!event.persisted || isLoginPage() || currentUser()) return;
    location.replace("login.html?next=" + encodeURIComponent(safeNext(pageName())));
  });

  function signIn(username, password) {
    var account = findAccount(username);
    if (!account || account.password !== password) {
      return "Nome de usuário ou senha incorretos.";
    }
    try {
      remember(account.username);
    } catch (error) {
      return "Não foi possível entrar neste navegador.";
    }
    return null;
  }

  function signUp(username, password, confirm, email) {
    var trimmedUser = username.trim();
    var trimmedEmail = email.trim();
    if (!trimmedUser || !password || !confirm || !trimmedEmail) {
      return "Preencha todos os campos.";
    }
    if (password !== confirm) return "As senhas não coincidem.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      return "Informe um email válido.";
    }

    var accounts = readAccounts();
    var userKey = trimmedUser.toLowerCase();
    var emailKey = trimmedEmail.toLowerCase();
    for (var i = 0; i < accounts.length; i += 1) {
      var existing = accounts[i];
      if (!existing || typeof existing !== "object") continue;
      if (String(existing.username || "").toLowerCase() === userKey) {
        return "Esse nome de usuário já está em uso.";
      }
      if (String(existing.email || "").toLowerCase() === emailKey) {
        return "Esse email já está em uso.";
      }
    }

    accounts.push({
      username: trimmedUser,
      password: password,
      email: trimmedEmail,
      money: STARTING_MONEY,
    });

    try {
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      remember(trimmedUser);
    } catch (error) {
      return "Não foi possível salvar a conta neste navegador.";
    }
    return null;
  }

  function accountMoney(account) {
    var value = account && account.money;
    if (typeof value !== "number" || !isFinite(value)) return STARTING_MONEY;
    return Math.max(0, Math.round(value));
  }

  function currentMoney() {
    var name = currentUser();
    if (!name) return STARTING_MONEY;
    return accountMoney(findAccount(name));
  }

  function setMoney(amount) {
    var name = currentUser();
    var next = Math.round(Number(amount));
    var accounts;
    var i;
    var account;
    if (!name || !isFinite(next)) return;
    next = Math.max(0, next);
    accounts = readAccounts();
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      if (!account || typeof account.username !== "string") continue;
      if (account.username.toLowerCase() !== name.toLowerCase()) continue;
      account.money = next;
      localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
      return;
    }
  }

  function paintBalance() {
    var node = document.querySelector(".balance");
    if (!node) return;
    node.textContent = "Você tem $" + currentMoney();
  }

  function paintAccount() {
    var name = currentUser();
    var welcome = document.querySelector(".welcome-name");
    var profile = document.querySelector(".profile-name");
    if (welcome && name) welcome.textContent = name;
    if (profile && name) profile.textContent = name;
    paintBalance();
  }

  window.PokerLifeAuth = {
    currentMoney: currentMoney,
    setMoney: setMoney,
  };

  function showError(form, message) {
    var el = form.querySelector(".form-error");
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  if (!isLoginPage() && currentUser()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paintAccount);
    else paintAccount();
  }

  if (!isLoginPage() && !currentUser()) {
    location.replace("login.html?next=" + encodeURIComponent(safeNext(pageName())));
    return;
  }

  if (isLoginPage() && currentUser()) {
    location.replace(destination());
    return;
  }

  if (!isLoginPage()) return;

  document.addEventListener("DOMContentLoaded", function () {
    var loginForm = document.querySelector("#login-form");
    var signupForm = document.querySelector("#signup-form");

    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(loginForm);
        showError(
          loginForm,
          signIn(String(data.get("username") || ""), String(data.get("password") || ""))
        );
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(signupForm);
        showError(
          signupForm,
          signUp(
            String(data.get("username") || ""),
            String(data.get("password") || ""),
            String(data.get("confirm") || ""),
            String(data.get("email") || "")
          )
        );
      });
    }
  });
})();
