(function () {
  var ACCOUNTS_KEY = "pokerlife.accounts";
  var SESSION_KEY = "pokerlife.session";
  // Shared cloud bin so the same username/password works in any browser.
  var CLOUD_URL = "https://json.extendsclass.com/bin/ddfaeaf";
  var STARTING_MONEY = 150;
  var OPENING_CUT = 350;
  var ALLOWANCE = 100;
  var ALLOWANCE_HOUR = 7;
  // 25 Oct 2026 is the last Sunday the mesada stays at $100.
  // Each later Sunday at 7:00 doubles it for the week that follows.
  var ALLOWANCE_ANCHOR = new Date(2026, 9, 25);
  var syncing = null;

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

  function touchAccount(account) {
    if (!account || typeof account !== "object") return account;
    account.updatedAt = Date.now();
    return account;
  }

  function saveAccountsLocal(accounts) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  }

  function accountStamp(account) {
    return account && typeof account.updatedAt === "number" && isFinite(account.updatedAt)
      ? account.updatedAt
      : 0;
  }

  function mergeAccounts(localAccounts, remoteAccounts) {
    var map = {};
    var order = [];
    var lists = [remoteAccounts, localAccounts];
    var listIndex;
    var i;
    var account;
    var key;
    var previous;

    function consider(candidate) {
      if (!candidate || typeof candidate !== "object") return;
      if (typeof candidate.username !== "string" || !candidate.username.trim()) return;
      key = candidate.username.trim().toLowerCase();
      previous = map[key];
      if (!previous) {
        map[key] = candidate;
        order.push(key);
        return;
      }
      if (accountStamp(candidate) >= accountStamp(previous)) map[key] = candidate;
    }

    for (listIndex = 0; listIndex < lists.length; listIndex += 1) {
      if (!Array.isArray(lists[listIndex])) continue;
      for (i = 0; i < lists[listIndex].length; i += 1) consider(lists[listIndex][i]);
    }

    return order.map(function (name) {
      return map[name];
    });
  }

  function stampLegacyAccounts(accounts) {
    var now = Date.now();
    var i;
    var account;
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      if (!account || typeof account !== "object") continue;
      if (typeof account.updatedAt !== "number" || !isFinite(account.updatedAt)) {
        account.updatedAt = now;
      }
    }
    return accounts;
  }

  function cloudLoad() {
    return fetch(CLOUD_URL + "?t=" + Date.now(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (!response.ok) throw new Error("cloud read failed");
      return response.json();
    }).then(function (payload) {
      if (Array.isArray(payload)) return payload;
      if (payload && Array.isArray(payload.accounts)) return payload.accounts;
      return [];
    });
  }

  function cloudSave(accounts) {
    return fetch(CLOUD_URL, {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ accounts: accounts }),
    }).then(function (response) {
      if (!response.ok) throw new Error("cloud write failed");
      return accounts;
    });
  }

  function writeAccounts(accounts, options) {
    var opts = options || {};
    saveAccountsLocal(accounts);
    if (opts.skipCloud) return Promise.resolve(accounts);
    return cloudSave(accounts).catch(function () {
      return accounts;
    });
  }

  function syncAccounts() {
    if (syncing) return syncing;
    syncing = cloudLoad()
      .catch(function () {
        return null;
      })
      .then(function (remote) {
        var local = stampLegacyAccounts(readAccounts());
        var merged;
        if (!remote) {
          if (!local.length) return local;
          return cloudSave(local).catch(function () {
            return local;
          });
        }
        merged = mergeAccounts(local, remote);
        saveAccountsLocal(merged);
        return cloudSave(merged).catch(function () {
          return merged;
        });
      })
      .then(function (accounts) {
        syncing = null;
        return accounts;
      }, function (error) {
        syncing = null;
        throw error;
      });
    return syncing;
  }

  function applyOpeningCut() {
    var accounts = readAccounts();
    var changed = false;
    var i;
    var account;
    var money;
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      if (!account || typeof account !== "object" || account.openingCutApplied) continue;
      money = account.money;
      if (typeof money !== "number" || !isFinite(money)) money = STARTING_MONEY + OPENING_CUT;
      account.money = Math.max(0, Math.round(money) - OPENING_CUT);
      account.openingCutApplied = true;
      touchAccount(account);
      changed = true;
    }
    if (!changed) return;
    try {
      writeAccounts(accounts);
    } catch (error) {}
  }

  function grantBergGift() {
    var accounts = readAccounts();
    var changed = false;
    var i;
    var account;
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      if (!account || typeof account.username !== "string") continue;
      if (account.username.trim().toLowerCase() !== "berg") continue;
      if (!account.gift50) {
        account.money = accountMoney(account) + 50;
        account.gift50 = true;
        touchAccount(account);
        changed = true;
      }
      if (!account.gift150) {
        account.money = accountMoney(account) + 150;
        account.gift150 = true;
        touchAccount(account);
        changed = true;
      }
    }
    if (!changed) return;
    try {
      writeAccounts(accounts);
    } catch (error) {}
  }

  applyOpeningCut();
  grantBergGift();
  syncAccounts().then(function () {
    applyOpeningCut();
    grantBergGift();
    if (!isLoginPage() && currentUser()) paintAccount();
  });

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

    accounts.push(
      touchAccount({
        username: trimmedUser,
        password: password,
        email: trimmedEmail,
        money: STARTING_MONEY,
        openingCutApplied: true,
      })
    );

    try {
      saveAccountsLocal(accounts);
    } catch (error) {
      return Promise.resolve("Não foi possível salvar a conta neste navegador.");
    }
    return writeAccounts(accounts)
      .then(function () {
        remember(trimmedUser);
        return null;
      })
      .catch(function () {
        remember(trimmedUser);
        return null;
      });
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

  function updateAccount(mutator) {
    var name = currentUser();
    var accounts;
    var i;
    var account;
    if (!name) return null;
    accounts = readAccounts();
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      if (!account || typeof account.username !== "string") continue;
      if (account.username.toLowerCase() !== name.toLowerCase()) continue;
      mutator(account);
      touchAccount(account);
      writeAccounts(accounts);
      return account;
    }
    return null;
  }

  function readItems(account) {
    var items = account && account.items;
    var owned = [];
    var i;
    if (!Array.isArray(items)) return owned;
    for (i = 0; i < items.length; i += 1) {
      if (typeof items[i] === "string" && items[i].trim() && owned.indexOf(items[i]) === -1) owned.push(items[i]);
    }
    return owned;
  }

  function pushLedger(account, delta, label) {
    var amount = Math.round(delta);
    if (!amount || !label) return;
    if (!Array.isArray(account.ledger)) account.ledger = [];
    account.ledger.push({ delta: amount, label: label });
    if (account.ledger.length > 100) account.ledger.splice(0, account.ledger.length - 100);
  }

  function ledgerText(delta, label) {
    return (delta > 0 ? "+" : "-") + "$" + Math.abs(delta) + " → " + label;
  }

  function setMoney(amount, label) {
    var next = Math.round(Number(amount));
    if (!isFinite(next)) return;
    next = Math.max(0, next);
    updateAccount(function (account) {
      var prev = accountMoney(account);
      account.money = next;
      if (label) pushLedger(account, next - prev, label);
    });
  }

  function buyItem(name, price) {
    var trimmed = String(name || "").trim();
    var cost = Math.round(Number(price));
    var result = { ok: false, error: "Não foi possível comprar." };
    if (!trimmed || !isFinite(cost) || cost <= 0) return result;
    if (!updateAccount(function (account) {
      var items = readItems(account);
      var money = accountMoney(account);
      if (items.indexOf(trimmed) !== -1) {
        result = { ok: false, error: "Você já tem esse item." };
        return;
      }
      if (money < cost) {
        result = { ok: false, error: "Dinheiro insuficiente." };
        return;
      }
      account.money = money - cost;
      items.push(trimmed);
      account.items = items;
      pushLedger(account, -cost, "compra do item " + trimmed);
      result = { ok: true, error: "" };
    })) return result;
    return result;
  }

  function allowanceWindowStart(now) {
    var date = new Date(now);
    var start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), ALLOWANCE_HOUR, 0, 0, 0);
    if (date < start) start.setDate(start.getDate() - 1);
    return start.getTime();
  }

  function nextAllowanceAt(now) {
    var next = new Date(allowanceWindowStart(now));
    next.setDate(next.getDate() + 1);
    return next.getTime();
  }

  function allowanceDoublings(now) {
    var start = new Date(allowanceWindowStart(now));
    var days = Math.round(
      (Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) -
        Date.UTC(
          ALLOWANCE_ANCHOR.getFullYear(),
          ALLOWANCE_ANCHOR.getMonth(),
          ALLOWANCE_ANCHOR.getDate()
        )) /
        86400000
    );
    var weeks = Math.floor(days / 7);
    if (weeks < 0) return 0;
    if (weeks > 46) return 46;
    return weeks;
  }

  function allowanceAmount(now) {
    return ALLOWANCE * Math.pow(2, allowanceDoublings(now));
  }

  function sundayAllowanceAmount(now) {
    var start = new Date(allowanceWindowStart(now));
    var daysUntilSunday = (7 - start.getDay()) % 7;
    var sunday;
    if (daysUntilSunday === 0) daysUntilSunday = 7;
    sunday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + daysUntilSunday, ALLOWANCE_HOUR, 0, 0, 0);
    return allowanceAmount(sunday.getTime());
  }

  function allowanceReady(now) {
    var account = findAccount(currentUser() || "");
    var claimed = account && account.allowanceClaimedWindow;
    if (typeof claimed !== "number" || !isFinite(claimed)) return true;
    return claimed !== allowanceWindowStart(now);
  }

  function claimAllowance() {
    var now = Date.now();
    var windowStart = allowanceWindowStart(now);
    var claimed = false;
    updateAccount(function (account) {
      if (account.allowanceClaimedWindow === windowStart) return;
      account.money = accountMoney(account) + allowanceAmount(now);
      account.allowanceClaimedWindow = windowStart;
      pushLedger(account, allowanceAmount(now), "mesada do dia");
      claimed = true;
    });
    return claimed;
  }

  function formatRemaining(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    function pad(value) {
      return (value < 10 ? "0" : "") + value;
    }
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }

  function paintAllowanceAmount(amount) {
    var nodes = document.querySelectorAll(".allowance-amount");
    var label = "$" + amount;
    var i;
    for (i = 0; i < nodes.length; i += 1) nodes[i].textContent = label;
  }

  function paintBalance() {
    var node = document.querySelector(".balance");
    if (!node) return;
    node.textContent = "Você tem $" + currentMoney();
  }

  function paintAllowance() {
    var waiting = document.querySelector(".allowance-waiting");
    var ready = document.querySelector(".allowance-ready");
    var countdown = document.querySelector(".countdown");
    var button = document.querySelector(".allowance-claim");
    var now;
    var available;
    if (!waiting || !ready) return;
    now = Date.now();
    available = allowanceReady(now);
    waiting.hidden = available;
    ready.hidden = !available;
    if (button) button.hidden = !available;
    paintAllowanceAmount(available ? allowanceAmount(now) : allowanceAmount(nextAllowanceAt(now)));
    if (!available && countdown) {
      countdown.textContent = formatRemaining(nextAllowanceAt(now) - now);
    }
  }

  var allowanceTicking = false;

  function paintAccount() {
    var name = currentUser();
    var welcome = document.querySelector(".welcome-name");
    var profile = document.querySelector(".profile-name");
    var button = document.querySelector(".allowance-claim");
    if (welcome && name) welcome.textContent = name;
    if (profile && name) profile.textContent = name;
    paintBalance();
    paintAllowance();
    paintProfile();
    if (button && !button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", function () {
        if (!claimAllowance()) return;
        paintBalance();
        paintAllowance();
      });
    }
    if (!allowanceTicking && document.querySelector(".allowance")) {
      allowanceTicking = true;
      window.setInterval(paintAllowance, 1000);
    }
  }

  function paintProfile() {
    var account = findAccount(currentUser() || "");
    var user = document.querySelector(".account-username");
    var email = document.querySelector(".account-email");
    var money = document.querySelector(".account-money");
    var mesada = document.querySelector(".account-mesada");
    if (user) user.textContent = currentUser() || "";
    if (email) email.textContent = account && account.email ? account.email : "";
    if (money) money.textContent = "$" + currentMoney();
    if (mesada) {
      var now = Date.now();
      mesada.textContent = "$" + allowanceAmount(now) + " ($" + sundayAllowanceAmount(now) + " nos Domingos)";
    }
    paintItems(account);
    paintLedger(account);
  }

  function paintItems(account) {
    var list = document.querySelector(".account-items");
    var items;
    var i;
    var item;
    if (!list) return;
    list.textContent = "";
    items = readItems(account);
    for (i = 0; i < items.length; i += 1) {
      item = document.createElement("li");
      item.textContent = items[i];
      list.appendChild(item);
    }
  }

  function paintLedger(account) {
    var box = document.querySelector(".account-ledger");
    var entries;
    var i;
    var entry;
    var line;
    if (!box) return;
    box.textContent = "";
    entries = account && Array.isArray(account.ledger) ? account.ledger : [];
    for (i = entries.length - 1; i >= 0; i -= 1) {
      entry = entries[i];
      if (!entry || typeof entry.delta !== "number" || !entry.label) continue;
      line = document.createElement("p");
      line.className = "ledger";
      line.textContent = ledgerText(entry.delta, entry.label);
      box.appendChild(line);
    }
  }

  function signOut() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {}
    location.replace("login.html");
  }

  function changePassword(email, next, confirm) {
    var account = findAccount(currentUser() || "");
    var trimmed = String(email || "").trim();
    if (!trimmed || !next || !confirm) return "Preencha todos os campos.";
    if (!account || String(account.email || "").toLowerCase() !== trimmed.toLowerCase()) {
      return "Esse email não é o da sua conta.";
    }
    if (next !== confirm) return "As senhas não coincidem.";
    try {
      if (!updateAccount(function (record) {
        record.password = next;
      })) return "Não foi possível salvar a conta neste navegador.";
    } catch (error) {
      return "Não foi possível salvar a conta neste navegador.";
    }
    return null;
  }

  function changeEmail(email) {
    var trimmed = email.trim();
    var name = currentUser();
    var accounts;
    var i;
    var existing;
    var emailKey;
    if (!trimmed) return "Preencha todos os campos.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "Informe um email válido.";
    emailKey = trimmed.toLowerCase();
    accounts = readAccounts();
    for (i = 0; i < accounts.length; i += 1) {
      existing = accounts[i];
      if (!existing || typeof existing !== "object") continue;
      if (name && String(existing.username || "").toLowerCase() === name.toLowerCase()) continue;
      if (String(existing.email || "").toLowerCase() === emailKey) return "Esse email já está em uso.";
    }
    try {
      if (!updateAccount(function (account) {
        account.email = trimmed;
      })) return "Não foi possível salvar a conta neste navegador.";
    } catch (error) {
      return "Não foi possível salvar a conta neste navegador.";
    }
    return null;
  }

  function showFormMessage(form, message, success) {
    var el = form.querySelector(".form-error");
    if (!el) return;
    el.classList.toggle("form-success", !!success);
    if (!message) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = message;
  }

  function bindAccountForms() {
    var passwordForm = document.querySelector("#password-form");
    var emailForm = document.querySelector("#email-form");
    var logout = document.querySelector("#logout");
    if (passwordForm) {
      passwordForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(passwordForm);
        var message = changePassword(
          String(data.get("email") || ""),
          String(data.get("password") || ""),
          String(data.get("confirm") || "")
        );
        if (message) {
          showFormMessage(passwordForm, message, false);
          return;
        }
        passwordForm.reset();
        showFormMessage(passwordForm, "Senha alterada.", true);
      });
    }
    if (emailForm) {
      emailForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(emailForm);
        var message = changeEmail(String(data.get("email") || ""));
        if (message) {
          showFormMessage(emailForm, message, false);
          return;
        }
        emailForm.reset();
        showFormMessage(emailForm, "Email alterado.", true);
        paintProfile();
      });
    }
    if (logout) {
      logout.addEventListener("click", function () {
        signOut();
      });
    }
  }

  window.PokerLifeAuth = {
    currentMoney: currentMoney,
    setMoney: setMoney,
    buyItem: buyItem,
    items: function () {
      return readItems(findAccount(currentUser() || "")).slice();
    },
  };

  function showError(form, message) {
    showFormMessage(form, message, false);
  }

  if (!isLoginPage() && currentUser()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", paintAccount);
      document.addEventListener("DOMContentLoaded", bindAccountForms);
    } else {
      paintAccount();
      bindAccountForms();
    }
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

    function withCloud(form, action) {
      var submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.disabled = true;
      showError(form, "Conectando…");
      return syncAccounts()
        .catch(function () {
          return readAccounts();
        })
        .then(function () {
          return action();
        })
        .then(function (message) {
          if (submit) submit.disabled = false;
          showError(form, message);
        });
    }

    if (loginForm) {
      loginForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(loginForm);
        withCloud(loginForm, function () {
          return signIn(String(data.get("username") || ""), String(data.get("password") || ""));
        });
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(signupForm);
        withCloud(signupForm, function () {
          return signUp(
            String(data.get("username") || ""),
            String(data.get("password") || ""),
            String(data.get("confirm") || ""),
            String(data.get("email") || "")
          );
        });
      });
    }
  });
})();
