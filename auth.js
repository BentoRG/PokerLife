(function () {
  var ACCOUNTS_KEY = "pokerlife.accounts";
  var SESSION_KEY = "pokerlife.session";
  // Shared cloud key so the same username/password works in any browser.
  // ExtendsClass PUTs fail browser CORS preflight (OPTIONS 500); KVdb allows cross-origin read/write.
  var CLOUD_BUCKET = "https://kvdb.io/HmDEK9RXFZRnF1iG7XRCV4/";
  var CLOUD_URL = CLOUD_BUCKET + "accounts";
  var STARTING_MONEY = 150;
  var OPENING_CUT = 350;
  var ALLOWANCE = 100;
  var ALLOWANCE_HOUR = 7;
  var BROKE_ALLOWANCE_CUT = 15;
  var SAVINGS_DAILY_RATE = 0.015;
  var LOAN_PRINCIPAL = 100;
  var LOAN_DAILY_FEE = 5;
  var RESET_TOKEN_MS = 2 * 60 * 60 * 1000;
  var GAME_SPEED_KEY = "pokerlife.gameSpeed";
  var GAME_SPEED_SCALES = {
    "muito-lenta": 2,
    lenta: 1.45,
    normal: 1,
    rapida: 0.55,
    "muito-rapida": 0.28,
  };
  var RANKING_SNAP_KEY = "pokerlife.ranking.order";
  // Usernames removed on purpose; keep them out of merges, login, and the home ranking.
  var REMOVED_USERNAMES = {
    plain: true,
  };
  var syncing = null;
  var lastPaintedRankingSig = null;

  function pageName() {
    var name = location.pathname.split("/").pop();
    return name || "index.html";
  }

  function isLoginPage() {
    return pageName() === "login.html";
  }

  function isResetPage() {
    return pageName() === "redefinir.html";
  }

  function isHomePage() {
    return pageName() === "index.html";
  }

  function isPublicPage() {
    return isLoginPage() || isResetPage();
  }

  function safeNext(value) {
    if (typeof value !== "string") return "index.html";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(value)) return "index.html";
    if (value.toLowerCase() === "login.html") return "index.html";
    if (value.toLowerCase() === "redefinir.html") return "index.html";
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

  function dedupeEmails(accounts) {
    var winners = {};
    var i;
    var account;
    var email;
    for (i = 0; i < accounts.length; i += 1) {
      account = accounts[i];
      email = String((account && account.email) || "")
        .trim()
        .toLowerCase();
      if (!email) continue;
      if (!winners[email] || accountStamp(account) >= accountStamp(winners[email])) {
        winners[email] = account;
      }
    }
    return accounts.filter(function (entry) {
      email = String((entry && entry.email) || "")
        .trim()
        .toLowerCase();
      if (!email) return true;
      return winners[email] === entry;
    });
  }

  function isRemovedUsername(username) {
    var key = String(username || "")
      .trim()
      .toLowerCase();
    return !!(key && REMOVED_USERNAMES[key]);
  }

  function cleanAccounts(accounts) {
    var list = Array.isArray(accounts) ? accounts : [];
    list = list.filter(function (account) {
      if (!account || typeof account.username !== "string") return false;
      if (!account.username.trim()) return false;
      if (isRemovedUsername(account.username)) return false;
      return true;
    });
    return dedupeEmails(list);
  }

  function cloudLoad() {
    return fetch(CLOUD_URL + "?t=" + Date.now(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      // Missing key / empty store: treat as no accounts yet.
      if (response.status === 404) return [];
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
    var cleaned = cleanAccounts(accounts);
    saveAccountsLocal(cleaned);
    if (opts.skipCloud) return Promise.resolve(cleaned);
    return cloudLoad()
      .then(function (remote) {
        var merged = cleanAccounts(mergeAccounts(cleaned, remote));
        saveAccountsLocal(merged);
        return cloudSave(merged);
      })
      .then(function (merged) {
        return merged;
      }, function (error) {
        if (opts.requireCloud) throw error;
        return cleaned;
      });
  }

  function syncAccounts() {
    if (syncing) return syncing;
    syncing = cloudLoad()
      .then(function (remote) {
        var merged = cleanAccounts(mergeAccounts(readAccounts(), remote));
        saveAccountsLocal(merged);
        return cloudSave(merged);
      })
      .then(
        function (accounts) {
          syncing = null;
          return accounts;
        },
        function (error) {
          syncing = null;
          throw error;
        }
      );
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
    writeAccounts(accounts).catch(function () {});
  }

  syncAccounts()
    .then(function () {
      applyOpeningCut();
      if (!isLoginPage() && currentUser()) paintAccount();
    })
    .catch(function () {
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
    if (event.persisted && !isPublicPage() && !currentUser()) {
      location.replace("login.html?next=" + encodeURIComponent(safeNext(pageName())));
      return;
    }
    if (isHomePage() && currentUser()) refreshHomeRanking();
  });

  function signIn(username, password) {
    var account = findAccount(username);
    if (!account || String(account.password) !== String(password)) {
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
    if (isRemovedUsername(trimmedUser)) return "Esse nome de usuário não está disponível.";
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
    return writeAccounts(accounts, { requireCloud: true })
      .then(function () {
        remember(trimmedUser);
        return null;
      })
      .catch(function () {
        saveAccountsLocal(
          readAccounts().filter(function (account) {
            return !account || String(account.username || "").toLowerCase() !== userKey;
          })
        );
        return "Não foi possível salvar a conta na nuvem. Tente de novo.";
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

  function pushLedger(account, delta, label, detail) {
    var amount = Math.round(delta);
    var row;
    if (!amount || !label) return;
    if (!Array.isArray(account.ledger)) account.ledger = [];
    row = { delta: amount, label: label };
    if (detail && amount > 0 && Array.isArray(detail.cards) && detail.cards.length) {
      row.cards = detail.cards.map(function (card) {
        return String(card);
      });
      if (detail.hand) row.hand = String(detail.hand);
    }
    account.ledger.push(row);
    if (account.ledger.length > 100) account.ledger.splice(0, account.ledger.length - 100);
  }

  function ledgerText(delta, label) {
    return (delta > 0 ? "+" : "-") + "$" + Math.abs(delta) + " → " + label;
  }

  function ledgerWinDetailText(entry) {
    var cards;
    if (!entry || !Array.isArray(entry.cards) || !entry.cards.length) return "";
    cards = entry.cards.join(" ");
    if (entry.hand) return entry.hand + ": " + cards;
    return cards;
  }

  function startOfLocalDay(ms) {
    var date = new Date(typeof ms === "number" && isFinite(ms) ? ms : Date.now());
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function daysBetween(fromMs, toMs) {
    return Math.max(0, Math.round((startOfLocalDay(toMs) - startOfLocalDay(fromMs)) / 86400000));
  }

  function parseLocalDateInput(value) {
    var match;
    var year;
    var month;
    var day;
    if (typeof value !== "string") return null;
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
    if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
    var date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date.getTime();
  }

  function formatLocalDate(ms) {
    var date = new Date(startOfLocalDay(ms));
    function pad(value) {
      return (value < 10 ? "0" : "") + value;
    }
    return pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear();
  }

  function savingsPayout(amount, days) {
    var principal = Math.max(0, Math.round(amount));
    var stayed = Math.max(0, Math.round(days));
    return Math.ceil(principal * (1 + SAVINGS_DAILY_RATE * stayed));
  }

  function readSavings(account) {
    var list = account && account.savings;
    var out = [];
    var i;
    var entry;
    var amount;
    var depositedAt;
    var matureAt;
    if (!Array.isArray(list)) return out;
    for (i = 0; i < list.length; i += 1) {
      entry = list[i];
      if (!entry || typeof entry !== "object") continue;
      amount = Math.round(Number(entry.amount));
      depositedAt = Number(entry.depositedAt);
      matureAt = Number(entry.matureAt);
      if (!isFinite(amount) || amount <= 0) continue;
      if (!isFinite(depositedAt) || !isFinite(matureAt)) continue;
      out.push({ amount: amount, depositedAt: depositedAt, matureAt: matureAt });
    }
    return out;
  }

  function settleMaturedSavings(account, now) {
    var when = typeof now === "number" && isFinite(now) ? now : Date.now();
    var today = startOfLocalDay(when);
    var open = [];
    var paid = 0;
    var list;
    var i;
    var entry;
    var days;
    var payout;
    if (!account) return 0;
    list = readSavings(account);
    for (i = 0; i < list.length; i += 1) {
      entry = list[i];
      if (startOfLocalDay(entry.matureAt) > today) {
        open.push(entry);
        continue;
      }
      days = daysBetween(entry.depositedAt, entry.matureAt);
      payout = savingsPayout(entry.amount, days);
      account.money = accountMoney(account) + payout;
      pushLedger(account, payout, "retorno da poupança");
      paid += 1;
    }
    account.savings = open;
    return paid;
  }

  function depositSavings(amount, dateValue) {
    var principal = Math.round(Number(amount));
    var matureAt = parseLocalDateInput(dateValue);
    var today = startOfLocalDay(Date.now());
    var result = { ok: false, error: "Não foi possível guardar na poupança." };
    if (!isFinite(principal) || principal <= 0) {
      return { ok: false, error: "Informe um valor válido." };
    }
    if (matureAt === null) {
      return { ok: false, error: "Informe uma data válida." };
    }
    if (matureAt <= today) {
      return { ok: false, error: "Escolha uma data futura." };
    }
    if (!updateAccount(function (account) {
      var money;
      settleMaturedSavings(account);
      money = accountMoney(account);
      if (money < principal) {
        result = { ok: false, error: "Dinheiro insuficiente." };
        return;
      }
      account.money = money - principal;
      if (!Array.isArray(account.savings)) account.savings = [];
      account.savings.push({
        amount: principal,
        depositedAt: Date.now(),
        matureAt: matureAt,
      });
      pushLedger(account, -principal, "depósito na poupança");
      maybeBroke(account, money, account.money);
      result = { ok: true, error: "" };
    })) return result;
    return result;
  }

  function readLoan(account) {
    var loan = account && account.loan;
    var takenAt;
    if (!loan || typeof loan !== "object") return null;
    takenAt = Number(loan.takenAt);
    if (!isFinite(takenAt)) return null;
    return { takenAt: takenAt };
  }

  function loanOwed(account, now) {
    var loan = readLoan(account);
    var when = typeof now === "number" && isFinite(now) ? now : Date.now();
    if (!loan) return 0;
    return LOAN_PRINCIPAL + LOAN_DAILY_FEE * daysBetween(loan.takenAt, when);
  }

  function takeLoan() {
    var result = { ok: false, error: "Não foi possível pedir o empréstimo." };
    if (!updateAccount(function (account) {
      settleMaturedSavings(account);
      if (readLoan(account)) {
        result = { ok: false, error: "Pague o empréstimo atual antes de pedir outro." };
        return;
      }
      account.money = accountMoney(account) + LOAN_PRINCIPAL;
      account.loan = { takenAt: Date.now() };
      pushLedger(account, LOAN_PRINCIPAL, "empréstimo");
      result = { ok: true, error: "" };
    })) return result;
    return result;
  }

  function repayLoan() {
    var result = { ok: false, error: "Não foi possível pagar o empréstimo." };
    if (!updateAccount(function (account) {
      var owed;
      var money;
      settleMaturedSavings(account);
      if (!readLoan(account)) {
        result = { ok: false, error: "Você não tem empréstimo em aberto." };
        return;
      }
      owed = loanOwed(account);
      money = accountMoney(account);
      if (money < owed) {
        result = { ok: false, error: "Dinheiro insuficiente para pagar $" + owed + "." };
        return;
      }
      account.money = money - owed;
      delete account.loan;
      pushLedger(account, -owed, "pagamento do empréstimo");
      maybeBroke(account, money, account.money);
      result = { ok: true, error: "" };
    })) return result;
    return result;
  }

  function allowancePenaltyOf(account) {
    var value = account && account.allowancePenalty;
    if (typeof value !== "number" || !isFinite(value)) return 0;
    return Math.max(0, Math.round(value));
  }

  // Weekday mesada after broke cuts; Sunday is always double this amount.
  function weekdayAllowance(account) {
    return Math.max(0, ALLOWANCE - allowancePenaltyOf(account));
  }

  function applyBrokePenalty(account) {
    account.allowancePenalty = allowancePenaltyOf(account) + BROKE_ALLOWANCE_CUT;
    account.brokeAllowanceNotice = BROKE_ALLOWANCE_CUT;
  }

  function maybeBroke(account, previousMoney, nextMoney) {
    if (previousMoney > 0 && nextMoney <= 0) applyBrokePenalty(account);
  }

  function setMoney(amount, label, detail) {
    var next = Math.round(Number(amount));
    if (!isFinite(next)) return;
    next = Math.max(0, next);
    updateAccount(function (account) {
      var prev = accountMoney(account);
      var delta = next - prev;
      account.money = next;
      if (label) pushLedger(account, delta, label, delta > 0 ? detail : null);
      maybeBroke(account, prev, next);
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
      var next;
      if (items.indexOf(trimmed) !== -1) {
        result = { ok: false, error: "Você já tem esse item." };
        return;
      }
      if (money < cost) {
        result = { ok: false, error: "Dinheiro insuficiente." };
        return;
      }
      next = money - cost;
      account.money = next;
      items.push(trimmed);
      account.items = items;
      pushLedger(account, -cost, "compra do item " + trimmed);
      maybeBroke(account, money, next);
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

  function allowanceAmount(now) {
    var account = findAccount(currentUser() || "");
    var daily = weekdayAllowance(account);
    var start = new Date(allowanceWindowStart(now));
    return start.getDay() === 0 ? daily * 2 : daily;
  }

  function allowanceReady(now) {
    var account = findAccount(currentUser() || "");
    var claimed = account && account.allowanceClaimedWindow;
    if (typeof claimed !== "number" || !isFinite(claimed)) return true;
    return claimed !== allowanceWindowStart(now);
  }

  function allowanceLedgerLabel(now) {
    var start = new Date(allowanceWindowStart(now));
    var weekdays = [
      "domingo",
      "segunda-feira",
      "terça-feira",
      "quarta-feira",
      "quinta-feira",
      "sexta-feira",
      "sábado",
    ];
    return "mesada do dia (" + weekdays[start.getDay()] + ", " + formatLocalDate(start.getTime()) + ")";
  }

  function claimAllowance() {
    var now = Date.now();
    var windowStart = allowanceWindowStart(now);
    var amount = allowanceAmount(now);
    var claimed = false;
    updateAccount(function (account) {
      settleMaturedSavings(account, now);
      if (account.allowanceClaimedWindow === windowStart) return;
      account.money = accountMoney(account) + amount;
      account.allowanceClaimedWindow = windowStart;
      pushLedger(account, amount, allowanceLedgerLabel(now));
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

  function paintBrokeNotice() {
    var node = document.querySelector(".broke-notice");
    var account;
    var cut;
    if (!node) return;
    account = findAccount(currentUser() || "");
    cut = account && account.brokeAllowanceNotice;
    if (typeof cut !== "number" || !isFinite(cut) || cut <= 0) {
      node.hidden = true;
      node.textContent = "";
      return;
    }
    node.hidden = false;
    node.textContent =
      "Sua mesada foi reduzida em $" +
      Math.round(cut) +
      " ($" +
      Math.round(cut * 2) +
      " nos Domingos).";
    updateAccount(function (entry) {
      delete entry.brokeAllowanceNotice;
    });
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

  function readRankingSnapshot() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(RANKING_SNAP_KEY) || "null");
      return Array.isArray(parsed) ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writeRankingSnapshot(order) {
    try {
      sessionStorage.setItem(RANKING_SNAP_KEY, JSON.stringify(order));
    } catch (error) {}
  }

  function previousRankingPlaces(snapshot) {
    var places = {};
    var i;
    var entry;
    if (!snapshot) return places;
    for (i = 0; i < snapshot.length; i += 1) {
      entry = snapshot[i];
      if (!entry || typeof entry.name !== "string" || !entry.name.trim()) continue;
      if (typeof entry.place !== "number" || !isFinite(entry.place)) continue;
      places[entry.name.trim().toLowerCase()] = entry.place;
    }
    return places;
  }

  function rankingSignature(order) {
    return order
      .map(function (entry) {
        return entry.name + ":" + entry.money + ":" + entry.place;
      })
      .join("|");
  }

  function paintRanking() {
    var list = document.querySelector(".ranking");
    var accounts;
    var ranked;
    var previous = readRankingSnapshot();
    var prevPlaces = previousRankingPlaces(previous);
    var nextSnap = [];
    var place = 0;
    var signature;
    var i;
    var item;
    var account;
    var name;
    var money;
    var oldPlace;
    if (!list) return;
    accounts = cleanAccounts(readAccounts());
    ranked = accounts.slice().sort(function (a, b) {
      return accountMoney(b) - accountMoney(a);
    });
    for (i = 0; i < ranked.length; i += 1) {
      account = ranked[i];
      if (!account || typeof account.username !== "string" || !account.username.trim()) continue;
      place += 1;
      nextSnap.push({
        name: account.username.trim(),
        money: accountMoney(account),
        place: place,
      });
    }
    signature = rankingSignature(nextSnap);
    if (signature === lastPaintedRankingSig && list.children.length === nextSnap.length) return;
    list.textContent = "";
    for (i = 0; i < nextSnap.length; i += 1) {
      name = nextSnap[i].name;
      money = nextSnap[i].money;
      place = nextSnap[i].place;
      item = document.createElement("li");
      item.textContent = name + " ($" + money + ")";
      oldPlace = prevPlaces[name.toLowerCase()];
      if (previous && typeof oldPlace === "number") {
        if (place < oldPlace) {
          item.className = "rank-up";
          item.setAttribute("aria-label", name + " subiu no ranking");
        } else if (place > oldPlace) {
          item.className = "rank-down";
          item.setAttribute("aria-label", name + " desceu no ranking");
        }
      }
      list.appendChild(item);
    }
    lastPaintedRankingSig = signature;
    writeRankingSnapshot(nextSnap);
  }

  function refreshHomeRanking() {
    if (!isHomePage() || !document.querySelector(".ranking")) return;
    syncAccounts()
      .then(function () {
        paintRanking();
      })
      .catch(function () {
        paintRanking();
      });
  }

  function ensureSavingsSettled() {
    var paid = 0;
    var name = currentUser();
    var account = findAccount(name || "");
    if (!account) return 0;
    if (!readSavings(account).some(function (entry) {
      return startOfLocalDay(entry.matureAt) <= startOfLocalDay(Date.now());
    })) return 0;
    updateAccount(function (entry) {
      paid = settleMaturedSavings(entry);
    });
    return paid;
  }

  function tomorrowDateInputValue() {
    var date = new Date(startOfLocalDay(Date.now()) + 86400000);
    function pad(value) {
      return (value < 10 ? "0" : "") + value;
    }
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function paintSavingsList(account) {
    var box = document.querySelector(".savings-list");
    var list;
    var i;
    var entry;
    var line;
    var days;
    var payout;
    if (!box) return;
    box.textContent = "";
    list = readSavings(account);
    if (!list.length) {
      line = document.createElement("p");
      line.textContent = "Nenhuma poupança em andamento.";
      box.appendChild(line);
      return;
    }
    for (i = 0; i < list.length; i += 1) {
      entry = list[i];
      days = daysBetween(entry.depositedAt, entry.matureAt);
      payout = savingsPayout(entry.amount, days);
      line = document.createElement("p");
      line.textContent =
        "$" +
        entry.amount +
        " → recebe $" +
        payout +
        " em " +
        formatLocalDate(entry.matureAt) +
        " (" +
        days +
        (days === 1 ? " dia" : " dias") +
        ")";
      box.appendChild(line);
    }
  }

  function paintLoanPanel(account) {
    var status = document.querySelector(".loan-status");
    var take = document.querySelector(".loan-take");
    var repay = document.querySelector(".loan-repay");
    var loan = readLoan(account);
    var owed;
    var days;
    if (!status || !take || !repay) return;
    if (!loan) {
      status.textContent = "Você não tem empréstimo em aberto.";
      take.hidden = false;
      take.disabled = false;
      repay.hidden = true;
      return;
    }
    owed = loanOwed(account);
    days = daysBetween(loan.takenAt, Date.now());
    status.textContent =
      "Empréstimo em aberto desde " +
      formatLocalDate(loan.takenAt) +
      ": pagar $" +
      owed +
      " ($100 + $" +
      LOAN_DAILY_FEE +
      " × " +
      days +
      (days === 1 ? " dia" : " dias") +
      ").";
    take.hidden = true;
    repay.hidden = false;
  }

  function paintBank() {
    var account;
    if (!document.querySelector(".bank-card")) return;
    ensureSavingsSettled();
    account = findAccount(currentUser() || "");
    paintSavingsList(account);
    paintLoanPanel(account);
    paintLedger(account);
  }

  function showBankNotice(message) {
    var notice = document.getElementById("bank-notice");
    if (!notice) return;
    notice.hidden = !message;
    notice.textContent = message || "";
  }

  function bindBankForms() {
    var form = document.querySelector("#savings-form");
    var take = document.querySelector(".loan-take");
    var repay = document.querySelector(".loan-repay");
    var dateInput;
    if (form && !form.dataset.bound) {
      form.dataset.bound = "1";
      dateInput = form.querySelector('input[name="date"]');
      if (dateInput) dateInput.min = tomorrowDateInputValue();
      form.addEventListener("submit", function (event) {
        var data = new FormData(form);
        var result;
        event.preventDefault();
        result = depositSavings(data.get("amount"), data.get("date"));
        if (!result.ok) {
          showBankNotice(result.error);
          return;
        }
        form.reset();
        if (dateInput) dateInput.min = tomorrowDateInputValue();
        showBankNotice("Valor guardado na poupança.");
        paintBalance();
        paintBank();
        paintRanking();
      });
    }
    if (take && !take.dataset.bound) {
      take.dataset.bound = "1";
      take.addEventListener("click", function () {
        var result = takeLoan();
        if (!result.ok) {
          showBankNotice(result.error);
          return;
        }
        showBankNotice("Empréstimo de $100 recebido.");
        paintBalance();
        paintBank();
        paintRanking();
      });
    }
    if (repay && !repay.dataset.bound) {
      repay.dataset.bound = "1";
      repay.addEventListener("click", function () {
        var result = repayLoan();
        if (!result.ok) {
          showBankNotice(result.error);
          return;
        }
        showBankNotice("Empréstimo pago.");
        paintBalance();
        paintBank();
        paintRanking();
      });
    }
  }

  function paintAccount() {
    var name = currentUser();
    var welcome = document.querySelector(".welcome-name");
    var profile = document.querySelector(".profile-name");
    var button = document.querySelector(".allowance-claim");
    ensureSavingsSettled();
    if (welcome && name) welcome.textContent = name;
    if (profile && name) profile.textContent = name;
    paintBalance();
    paintAllowance();
    paintBrokeNotice();
    paintProfile();
    paintBank();
    bindBankForms();
    paintRanking();
    if (button && !button.dataset.bound) {
      button.dataset.bound = "1";
      button.addEventListener("click", function () {
        if (!claimAllowance()) return;
        paintBalance();
        paintAllowance();
        paintRanking();
      });
    }
    if (!allowanceTicking && document.querySelector(".allowance")) {
      allowanceTicking = true;
      window.setInterval(paintAllowance, 1000);
    }
  }

  function readGameSpeed() {
    try {
      var value = localStorage.getItem(GAME_SPEED_KEY) || "normal";
      if (!Object.prototype.hasOwnProperty.call(GAME_SPEED_SCALES, value)) return "normal";
      return value;
    } catch (error) {
      return "normal";
    }
  }

  function writeGameSpeed(value) {
    if (!Object.prototype.hasOwnProperty.call(GAME_SPEED_SCALES, value)) value = "normal";
    try {
      localStorage.setItem(GAME_SPEED_KEY, value);
    } catch (error) {}
    return value;
  }

  function gameSpeedScale() {
    return GAME_SPEED_SCALES[readGameSpeed()] || 1;
  }

  function paintGameSpeed() {
    var select = document.querySelector("#game-speed");
    if (!select) return;
    select.value = readGameSpeed();
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
      (function () {
        var daily = weekdayAllowance(account);
        mesada.textContent = "$" + daily + " ($" + daily * 2 + " nos Domingos)";
      })();
    }
    paintItems(account);
    paintLedger(account);
    paintGameSpeed();
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

  var ledgerExpanded = false;
  var LEDGER_PREVIEW = 5;

  function paintLedger(account) {
    var box = document.querySelector(".account-ledger");
    var entries;
    var valid = [];
    var visible;
    var i;
    var entry;
    var line;
    var detail;
    var toggle;
    if (!box) return;
    box.textContent = "";
    entries = account && Array.isArray(account.ledger) ? account.ledger : [];
    for (i = entries.length - 1; i >= 0; i -= 1) {
      entry = entries[i];
      if (!entry || typeof entry.delta !== "number" || !entry.label) continue;
      valid.push(entry);
    }
    visible = ledgerExpanded ? valid : valid.slice(0, LEDGER_PREVIEW);
    for (i = 0; i < visible.length; i += 1) {
      entry = visible[i];
      line = document.createElement("p");
      line.className = "ledger";
      line.textContent = ledgerText(entry.delta, entry.label);
      if (entry.delta > 0 && Array.isArray(entry.cards) && entry.cards.length) {
        line.className += " ledger-win";
        line.setAttribute("role", "button");
        line.setAttribute("tabindex", "0");
        line.setAttribute("aria-expanded", "false");
        line.title = "Ver cartas da mão";
        detail = document.createElement("p");
        detail.className = "ledger-detail";
        detail.hidden = true;
        detail.textContent = ledgerWinDetailText(entry);
        (function (row, panel) {
          function toggleDetail() {
            var open = panel.hidden;
            panel.hidden = !open;
            row.setAttribute("aria-expanded", open ? "true" : "false");
          }
          row.addEventListener("click", toggleDetail);
          row.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              toggleDetail();
            }
          });
        })(line, detail);
        box.appendChild(line);
        box.appendChild(detail);
      } else {
        box.appendChild(line);
      }
    }
    if (valid.length > LEDGER_PREVIEW) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "ledger-toggle";
      toggle.textContent = ledgerExpanded ? "Contrair" : "Expandir";
      toggle.addEventListener("click", function () {
        ledgerExpanded = !ledgerExpanded;
        paintLedger(findAccount(currentUser() || "") || account);
      });
      box.appendChild(toggle);
    } else {
      ledgerExpanded = false;
    }
  }

  function signOut() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch (error) {}
    location.replace("login.html");
  }

  function makeResetToken() {
    var bytes = new Uint8Array(24);
    var i;
    if (window.crypto && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (value) {
      return ("0" + value.toString(16)).slice(-2);
    }).join("");
  }

  function sendResetEmail(toEmail, resetUrl) {
    return fetch("https://formsubmit.co/ajax/" + encodeURIComponent(toEmail), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        _subject: "PokerLife — trocar senha",
        _template: "box",
        _captcha: "false",
        message:
          "Você pediu para trocar a senha da sua conta no PokerLife.\n\n" +
          "Abra o link abaixo e digite a nova senha duas vezes:\n" +
          resetUrl +
          "\n\nSe você não pediu isso, ignore este email.",
      }),
    }).then(function (response) {
      if (!response.ok) throw new Error("email failed");
      return response.json().catch(function () {
        return {};
      });
    });
  }

  function requestPasswordReset() {
    var name = currentUser();
    var account = findAccount(name || "");
    var email;
    var token;
    var accounts;
    var i;
    var resetUrl;
    if (!account) return Promise.resolve("Não foi possível achar sua conta.");
    email = String(account.email || "").trim();
    if (!email) return Promise.resolve("Sua conta não tem email.");
    token = makeResetToken();
    accounts = readAccounts();
    for (i = 0; i < accounts.length; i += 1) {
      if (!accounts[i] || typeof accounts[i].username !== "string") continue;
      if (accounts[i].username.toLowerCase() !== name.toLowerCase()) continue;
      accounts[i].passwordResetToken = token;
      accounts[i].passwordResetExpires = Date.now() + RESET_TOKEN_MS;
      touchAccount(accounts[i]);
      break;
    }
    resetUrl = new URL("redefinir.html", location.href);
    resetUrl.searchParams.set("token", token);
    return writeAccounts(accounts, { requireCloud: true })
      .then(function () {
        return sendResetEmail(email, resetUrl.toString());
      })
      .then(function () {
        return null;
      })
      .catch(function () {
        return "Não foi possível enviar o email. Tente de novo.";
      });
  }

  function completePasswordReset(token, next, confirm) {
    var key = String(token || "").trim();
    var password = String(next || "");
    var accounts;
    var i;
    var account;
    var stamp;
    if (!key || !password || !confirm) return Promise.resolve("Preencha todos os campos.");
    if (password !== confirm) return Promise.resolve("As senhas não coincidem.");
    accounts = readAccounts();
    account = null;
    for (i = 0; i < accounts.length; i += 1) {
      if (!accounts[i] || typeof accounts[i] !== "object") continue;
      if (String(accounts[i].passwordResetToken || "") !== key) continue;
      stamp = accounts[i].passwordResetExpires;
      if (typeof stamp !== "number" || !isFinite(stamp) || stamp < Date.now()) {
        return Promise.resolve("Esse link expirou. Peça um novo em Sua conta.");
      }
      account = accounts[i];
      break;
    }
    if (!account) return Promise.resolve("Esse link é inválido. Peça um novo em Sua conta.");
    account.password = password;
    delete account.passwordResetToken;
    delete account.passwordResetExpires;
    touchAccount(account);
    return writeAccounts(accounts, { requireCloud: true })
      .then(function () {
        return null;
      })
      .catch(function () {
        return "Não foi possível salvar a senha. Tente de novo.";
      });
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

  function showStatusMessage(el, message, success) {
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
    var logout = document.querySelector("#logout");
    var speedSelect = document.querySelector("#game-speed");
    var speedHint = document.querySelector("#speed-hint");
    if (speedSelect) {
      speedSelect.addEventListener("change", function () {
        writeGameSpeed(speedSelect.value);
        if (speedHint) {
          speedHint.hidden = false;
          speedHint.classList.add("form-success");
          speedHint.textContent = "Velocidade salva. Vale para a próxima mão no cassino.";
        }
      });
    }
    if (logout) {
      logout.addEventListener("click", function () {
        signOut();
      });
    }
  }

  function bindResetForm() {
    var form = document.querySelector("#reset-form");
    var params = new URLSearchParams(location.search);
    var token = params.get("token") || "";
    if (!form) return;
    if (!token) {
      showError(form, "Esse link é inválido. Peça um novo em Sua conta.");
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.disabled = true;
      showError(form, "Salvando…");
      syncAccounts()
        .catch(function () {
          return null;
        })
        .then(function () {
          return completePasswordReset(
            token,
            String(data.get("password") || ""),
            String(data.get("confirm") || "")
          );
        })
        .then(function (message) {
          if (submit) submit.disabled = false;
          if (message) {
            showError(form, message);
            return;
          }
          form.reset();
          showFormMessage(form, "Senha alterada. Você já pode entrar com a senha nova.", true);
        });
    });
  }

  function roomUrl(code) {
    var key = String(code || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 8);
    if (!key) return null;
    return CLOUD_BUCKET + "room-" + key;
  }

  function loadRoom(code) {
    var url = roomUrl(code);
    if (!url) return Promise.reject(new Error("invalid room"));
    return fetch(url + "?t=" + Date.now(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
    }).then(function (response) {
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("room read failed");
      return response.json();
    });
  }

  function saveRoom(code, room) {
    var url = roomUrl(code);
    if (!url) return Promise.reject(new Error("invalid room"));
    room = room || {};
    room.updatedAt = Date.now();
    return fetch(url, {
      method: "PUT",
      cache: "no-store",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(room),
    }).then(function (response) {
      if (!response.ok) throw new Error("room write failed");
      return room;
    });
  }

  function deleteRoom(code) {
    var url = roomUrl(code);
    if (!url) return Promise.resolve();
    return fetch(url, { method: "DELETE", cache: "no-store" }).then(function () {
      return null;
    }).catch(function () {
      return null;
    });
  }

  window.PokerLifeAuth = {
    currentUser: currentUser,
    currentMoney: currentMoney,
    setMoney: setMoney,
    buyItem: buyItem,
    items: function () {
      return readItems(findAccount(currentUser() || "")).slice();
    },
    depositSavings: depositSavings,
    takeLoan: takeLoan,
    repayLoan: repayLoan,
    loanOwed: function () {
      return loanOwed(findAccount(currentUser() || ""));
    },
    loadRoom: loadRoom,
    saveRoom: saveRoom,
    deleteRoom: deleteRoom,
    normalizeRoomCode: function (code) {
      return String(code || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 8);
    },
    gameSpeed: readGameSpeed,
    setGameSpeed: writeGameSpeed,
    gameSpeedScale: gameSpeedScale,
  };

  function showError(form, message) {
    showFormMessage(form, message, false);
  }

  if (!isPublicPage() && currentUser()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", paintAccount);
      document.addEventListener("DOMContentLoaded", bindAccountForms);
    } else {
      paintAccount();
      bindAccountForms();
    }
  }

  if (!isPublicPage() && !currentUser()) {
    location.replace("login.html?next=" + encodeURIComponent(safeNext(pageName())));
    return;
  }

  if (isLoginPage() && currentUser()) {
    location.replace(destination());
    return;
  }

  if (isResetPage()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bindResetForm);
    } else {
      bindResetForm();
    }
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
        .then(function () {
          return action();
        })
        .then(function (message) {
          if (submit) submit.disabled = false;
          showError(form, message);
        })
        .catch(function () {
          if (submit) submit.disabled = false;
          showError(form, "Não foi possível conectar. Tente de novo.");
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
