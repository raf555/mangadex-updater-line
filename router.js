const express = require("express"),
  line_login = require("line-login"),
  session = require("express-session"),
  editJsonFile = require("edit-json-file"),
  { Mangadex } = require("mangadex-api"),
  line = require("@line/bot-sdk"),
  axios = require("axios"),
  NodeCache = require("node-cache");

const app = express.Router(),
  session_options = {
    secret: process.env.login_secret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 3600 * 1000 }
  },
  config = {
    channelAccessToken: process.env.acc_token,
    channelSecret: process.env.acc_secret
  },
  client = new line.Client(config),
  myCache = new NodeCache({ stdTTL: 86400 }),
  login = new line_login({
    channel_id: process.env.acc_id,
    channel_secret: process.env.login_secret,
    callback_url: process.env.login_callback,
    scope: "openid profile",
    //prompt: "consent",
    bot_prompt: "normal"
  }),
  mclient = new Mangadex();

// bot / site status
const stat = require(__dirname + "/status")
const closed = stat.closed;
const check = stat.checker

// manga limit
const limit = 10;

// login
mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);

// api endpoint
let endpointlist = [
  "https://api.mangadex.org/v2/",
  "https://mangadex.org/api/v2/"
];
let endpoint = endpointlist[1];

app.use(session(session_options));

/* for frontend js */
app.get("/dex.js", function(req, res) {
  res.sendFile(__dirname + "/public/static/dex.js");
});

/* login router */
app.use("/login", login.auth());
app.get("/logout", isloggedin, function(req, res) {
  login.revoke_access_token(req.session.acc_token).then(() => {
    req.session.destroy();
  });
  res.redirect("/login");
});
app.use(
  "/login_callback",
  login.callback(
    (req, res, next, token_response) => {
      req.session.acc_token = token_response.access_token;
      req.session.refresh_token = token_response.refresh_token;
      req.session.uid = token_response.id_token.sub;
      req.session.mis = token_response.id_token;
      //res.json(token_response);
      if (req.session.redir && req.session.redir != "/") {
        var redir = req.session.redir;
        req.session.redir = "/";
        res.redirect(redir);
      } else {
        res.redirect("/");
      }
    },
    (req, res, next, error) => {
      res.redirect("/login");
    }
  )
);

/* dashboard */
app.get("/", isloggedin, async (req, res) => {
  if (req.session.uid == process.env.admin_id) {
    let db = editJsonFile("db/_dexuser.json");
    let db2 = editJsonFile("db/_dexmanga.json");
    let data = Object.keys(db.get());
    let data2 = Object.keys(db2.get());
    let c = 0;
    let c2 = 0;
    let dex = true;
    let api = true;
    try {
      await axios.get("https://mangadex.org");
    } catch (e) {
      dex = false;
    }
    try {
      await axios.get(endpoint);
    } catch (e) {
      api = false;
    }
    for (let id of data) {
      if (Object.keys(db.get(id)).length > 0) {
        c += 1;
      }
    }
    for (let id of data2) {
      if (Object.keys(db2.get(id).follower).length > 0) {
        c2 += 1;
      }
    }
    let pushdb = editJsonFile("db/pushlimit.json");
    let pushdata = pushdb.get("data");
    let avg = 0;
    for (let i in pushdata) {
      avg += pushdata[i];
    }
    avg /= pushdata.length;
    res.render("index", {
      kuota: pushdb.get("quota"),
      user: c,
      manga: c2,
      dex: dex,
      api: api,
      avg: avg
    });
  } else {
    res.redirect("/dex");
  }
});

/* front page */
app.get("/dex", isloggedin, async (req, res) => {
  if (closed) {
    res.sendFile(__dirname + "/public/error.html");
    return false;
  }

  // login
  /*
  try {
    await mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);
  } catch (e) {
    res.sendFile(__dirname + "/public/error.html");
    return false;
  }*/

  let _manga = editJsonFile("db/_dexmanga.json");
  let _user = editJsonFile("db/_dexuser.json");

  let searchu = "";
  let uid = req.session.uid;
  let userdb = editJsonFile("db/user.json");
  let add = userdb.get(uid) && !userdb.get(uid + ".block");
  let cache = !(req.query.nocache && req.query.nocache == 1); // refresh cache

  if (add) {
    // if there is search param
    if (
      req.query.q &&
      req.query.q != "" &&
      req.query.s &&
      req.query.s == "1" &&
      /https:\/\/dex-line.glitch\.me/.test(req.get("referer"))
    ) {
      let search, query;
      query = parseurl(req.query.q);

      if (!query) {
        query = req.query.q;
      }

      if (isNaN(query)) {
        // search result
        try {
          search = await getsearch(query, cache);
          // max search
          let byk = 5;
          let len = search.titles.length < byk ? search.titles.length : byk;
          for (let i = 0; i < len; i++) {
            let ada = false;
            if (
              _manga.get(search.titles[i].id + ".follower." + uid) &&
              _user.get(uid + "." + search.titles[i].id)
            ) {
              ada = true;
            }

            searchu += searchout(
              req.session.uid,
              search.titles[i],
              false,
              ada,
              false
            );
          }
        } catch (e) {
          searchu = "Failed to search manga..";
        }
      } else {
        try {
          search = await getmanga(query, cache);
          if (!search.isHentai) {
            let ada = false;
            if (
              _manga.get(query + ".follower." + uid) &&
              _user.get(uid + "." + query)
            ) {
              ada = true;
            }
            if (req.query.refresh && req.query.refresh == 1) {
              searchu += searchout(req.session.uid, search, true, ada);
            } else {
              searchu += searchout(req.session.uid, search, false, ada);
            }
          }
        } catch (e) {
          if (e.response.status == 404) {
            searchu = "";
          } else {
            searchu = "Failed to get manga data..";
          }
        }
      }
      if (searchu == "") {
        searchu = "Can't find anything with query <b>" + query + "</b>";
      }
    } else if (
      req.query.s &&
      req.query.s == "1" &&
      req.query.self &&
      req.query.self == 1 &&
      /https:\/\/dex-line.glitch\.me/.test(req.get("referer"))
    ) {
      if (_user.get(uid) && Object.keys(_user.get(uid)).length > 0) {
        let data = Object.keys(_user.get(uid));
        for (let i = 0; i < data.length; i++) {
          let search;
          try {
            search = await getmanga(data[i], cache);
            searchu += searchout(req.session.uid, search);
          } catch (e) {
            searchu = "Failed to get manga data..";
            break;
          }
        }
      } else {
        searchu = "You haven't followed anything..";
      }
    }
  }
  res.render("dex", {
    out: searchu,
    q: req.query.q,
    added: add,
    limit: limit,
    check: check
  });
});

/* follow / unfollow manga */
app.get("/api/dex/folunfol/:id", async (req, res) => {
  if (!req.get("referer")) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  } else {
    if (!/https:\/\/dex-line.glitch\.me/.test(req.get("referer"))) {
      res.send({ result: false, reason: "Unauthorized" });
      return false;
    }
  }
  if (!req.session.uid) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  }
  try {
    let added = await client.getProfile(req.session.uid);
    if (!editJsonFile("db/user.json").get(req.session.uid)) {
      res.send({
        result: false,
        reason: "User is not registered in database."
      });
      return false;
    }
  } catch (e) {
    res.send({
      result: false,
      reason: "User has blocked / not added the bot."
    });
    return false;
  }
  if (req.params.id) {
    let id = parseInt(req.params.id);

    // db
    let _manga = editJsonFile("db/_dexmanga.json");
    let _user = editJsonFile("db/_dexuser.json");

    let uid = req.session.uid; // uid
    let baru = false; // type

    if (isNaN(req.params.id) || req.params.id.match(/\./g) || id < 0) {
      res.send({ result: false, reason: "invalid argument" });
      return false;
    }

    if (!(!_user.get(uid + "." + id) && !_manga.get(id + ".follower." + uid))) {
      // unfollow a manga
      _user.unset(uid + "." + id);
      _manga.unset(id + ".follower." + uid);

      if (Object.keys(_manga.get(id + ".follower")).length - 1 <= 0) {
        try {
          await unfolmanga(id);
          _manga.unset(req.params.id);
        } catch (e) {
          res.send({ result: false, reason: "Unknown error occured" });
          return false;
        }
      }

      _manga.save();
      _user.save();
      res.send({ result: true, type: baru });
    } else {
      if (_user.get(uid) && Object.keys(_user.get(uid)).length >= limit) {
        res.send({ result: false, reason: "max" });
        return false;
      }
      let following = await ambilfollow();
      let mangafound = following.find(data => data.mangaId == id) != undefined;
      _user.set(uid + "." + id + ".group", "-");
      _manga.set(id + ".follower." + uid, 1);
      if (!mangafound) {
        try {
          await folmanga(id);
        } catch (e) {
          res.send({ result: false, reason: "Unknown error occured" });
          return false;
        }
      }
      _manga.save();
      _user.save();
      baru = true;
      res.send({ result: true, type: baru });
    }
  }
});

/* set group */
app.get("/api/dex/setgroup/:mangid/:grupid", async (req, res) => {
  if (!req.get("referer")) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  } else {
    if (!/https:\/\/dex-line.glitch\.me/.test(req.get("referer"))) {
      res.send({ result: false, reason: "Unauthorized" });
      return false;
    }
  }
  if (!req.session.uid) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  }
  try {
    let added = await client.getProfile(req.session.uid);
    if (!editJsonFile("db/user.json").get(req.session.uid)) {
      res.send({
        result: false,
        reason: "User is not registered in database."
      });
      return false;
    }
  } catch (e) {
    res.send({
      result: false,
      reason: "User has blocked / not added the bot."
    });
    return false;
  }
  if (req.params.mangid && req.params.grupid) {
    let _manga = editJsonFile("db/_dexmanga.json");
    let _user = editJsonFile("db/_dexuser.json");
    let _grup = editJsonFile("db/_dexgroup.json");
    let uid = req.session.uid;

    let mangid = req.params.mangid;
    let grupid = req.params.grupid;

    if (
      !(
        !_user.get(uid + "." + mangid) &&
        !_manga.get(mangid + ".follower." + uid)
      )
    ) {
      if (grupid == "-") {
        _user.set(uid + "." + mangid + ".group", "-");
        _user.save();
        res.send({ result: true, reason: "" });
        return false;
      } else {
        if (
          isNaN(mangid) ||
          mangid.match(/\./g) ||
          mangid < 0 ||
          isNaN(grupid) ||
          grupid.match(/\./g) ||
          grupid < 0
        ) {
          res.send({ result: false, reason: "invalid argument" });
          return false;
        } else {
          if (!_grup.get(grupid.toString())) {
            res.send({ result: false, reason: "invalid argument" });
            return false;
          }
          _user.set(uid + "." + mangid + ".group", grupid);
          _user.save();
          res.send({ result: true, reason: "" });
        }
      }
    } else {
      res.send({ result: false, reason: "Manga has not followed" });
      return false;
    }
  } else {
    res.send({ result: false, reason: "invalid argument" });
    return false;
  }
});

/* cache refresh for manga update */
app.get("/api/cache/refresh/:id", async (req, res) => {
  try {
    let id = req.params.id;
    if (myCache.has("manga-" + id)) {
      myCache.del("manga-" + id);
    }
    await getmanga(id);
    console.log("Manga cache with id " + id + " is just updated");
    res.send({ res: "ok" });
  } catch (e) {
    res.send({ res: "no" });
  }
});

/* mangadex status */
app.get("/dexstatus", async (req, res) => {
  let dex = true;
  let api = true;
  try {
    await axios.get("https://mangadex.org");
  } catch (e) {
    dex = false;
  }
  try {
    await axios.get(endpoint);
  } catch (e) {
    api = false;
  }
  let fail = "none";
  if (!dex && !api) {
    fail = "both";
  } else {
    if (!dex) {
      fail = "dex";
    } else if (!api) {
      fail = "api";
    }
  }
  res.send({ result: dex && api, fail: fail });
});

async function isloggedin(req, res, next) {
  try {
    let data = await login.verify_access_token(req.session.acc_token);
    next();
  } catch (e) {
    switch (req.path) {
      case "/":
        req.session.redir = "/";
        break;
      case "/dex":
        req.session.redir = "/dex";
        if (req.query.q && req.query.q != "") {
          req.session.redir += "?q=" + req.query.q;
        }
        break;
    }
    res.redirect("/login");
  }
}

function makegrupoption(id, mangaid, data) {
  try {
    let uid = id;
    let userdb = editJsonFile("db/_dexuser.json");
    let grupdb = editJsonFile("db/_dexgroup.json");

    let out = "";
    let selected = {};
    if (userdb.get(uid + "." + mangaid + ".group") == "-") {
      out += '<option value="-" selected>None</option>';
    } else {
      out +=
        '<option value="' +
        userdb.get(uid + "." + mangaid + ".group") +
        '" selected>' +
        grupdb.get(userdb.get(uid + "." + mangaid + ".group")).name +
        "</option>";
    }
    let chapt = data.chapters;
    let grup = [];
    for (let i in chapt) {
      if (grup.indexOf(chapt[i].groups[0]) == -1 && chapt[i].language == "gb")
        grup.push(chapt[i].groups[0]);
    }
    for (let i in grup) {
      if (!grupdb.get(grup[i].toString())) {
        let name = getgroupname(grup[i])
          .then(data => {
            grupdb.set(grup[i] + ".name", data);
            grupdb.save();
          })
          .catch(err => {
            return false;
          });
      }
      if (userdb.get(uid + "." + mangaid + ".group") != "-") {
        if (grup[i].toString() != userdb.get(uid + "." + mangaid + ".group")) {
          out +=
            '<option value="' +
            grup[i].toString() +
            '">' +
            grupdb.get(grup[i].toString()).name +
            "</option>";
        } else {
          out += '<option value="-">None</option>';
        }
      } else {
        out +=
          '<option value="' +
          grup[i].toString() +
          '">' +
          grupdb.get(grup[i].toString()).name +
          "</option>";
      }
    }
    return out;
  } catch (e) {
    return null;
  }
}

function parseurl(url, int = true) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  let hostname, pathname;
  hostname = parsed.hostname;
  pathname = parsed.pathname;
  if (hostname == "mangadex.org") {
    if (pathname) {
      pathname = pathname.substring(1);
      let split = pathname.split("/");
      if (split.length >= 2) {
        if (split[0] == "title") {
          if (!isNaN(split[1])) {
            return int ? parseInt(split[1]) : split[1];
          }
        }
      }
    }
  }
  return null;
}

function searchout(
  id,
  searchdata,
  fromself = true,
  ada = true,
  fromgetmanga = true
) {
  let db = editJsonFile("db/_dexmanga.json");
  let userdb = editJsonFile("db/_dexuser.json");

  let trimString = (string, length) => {
    return string.length > length
      ? string.substring(0, length) + "... "
      : string;
  };

  let count = id => {
    if (db.get(id.toString())) {
      return Object.keys(db.get(id + ".follower")).length;
    }
    return 0;
  };

  let findlatest = data => {
    let usergrup = userdb.get(id + "." + data.manga.id).group;
    let custgrup = false;
    if (usergrup != "-") {
      custgrup = true;
    }
    for (let i in data.chapters) {
      if (
        data.chapters[i].language == "gb" ||
        data.chapters[i].language == "en"
      ) {
        if (!custgrup) {
          return datetostr(
            convertTZ(
              new Date(data.chapters[i].timestamp * 1000),
              "Asia/Jakarta"
            )
          );
        } else {
          if (data.chapters[i].groups[0].toString() != usergrup) {
            continue;
          } else {
            return datetostr(
              convertTZ(
                new Date(data.chapters[i].timestamp * 1000),
                "Asia/Jakarta"
              )
            );
          }
        }
      }
    }
  };

  let search = fromgetmanga ? searchdata.manga : searchdata;

  // remove dex lang tag
  search.description = search.description.replace(/\[[^\]]+\]/g, "");

  let url = "https://mangadex.org/title/" + search.id;
  let out =
    '<div class="item list">' +
    '<div class="image">' +
    '<img src="' +
    (search.mainCover || search.image_url) +
    '" />' +
    "</div>" +
    '<div class="content">' +
    '<a class="header" target="_blank" href="' +
    url +
    '">' +
    search.title +
    '<span style="display:none">' +
    url +
    "</span></a>" +
    '<div class="meta">' +
    "<p>" +
    '<a style="color:#666666" title="Rating"><i class="star icon"></i> ' +
    (search.rating.bayesian || search.rating.value)
      .toFixed(2)
      .replace(".", ",") +
    "</a>" +
    '<a style="color:#666666" title="Views"><i class="eye icon"></i> ' +
    search.views.toLocaleString("id-ID") +
    '<a style="color:#666666" title="Follower" id="' +
    search.id +
    '"><i class="bookmark icon"></i> ' +
    count(search.id) +
    "</a>" +
    "</p>" +
    "</div>" +
    '<div class="description">' +
    "<p>" +
    trimString(search.description, 275) +
    (search.description.length >= 275
      ? '<a href="https://mangadex.org/title/' +
        search.id +
        '" target="_blank">See more</a>'
      : "") +
    //search.description +
    "</p>" +
    "</div>" +
    '<div class="extra">' +
    (!fromself
      ? ""
      : '<div class="ui left floated label lastup" style="cursor:pointer;" data-id="' +
        search.id +
        '" title="Click to refresh data">Last updated on ' +
        findlatest(searchdata) +
        " UTC+7" +
        "</div>") +
    '<button class="ui right floated folunfol ' +
    (ada ? "yellow" : "green") +
    ' button" data-id="' +
    search.id +
    '">' +
    '<i class="bookmark icon"></i>' +
    (ada ? "Unfollow" : "Follow") +
    "</button>" +
    (!fromself
      ? ""
      : '<div class="ui left floated accordion field">' +
        '<div class="title">' +
        '<i class="icon dropdown"></i>' +
        "Advanced" +
        "</div>" +
        '<div class="content field">' +
        "<label>Get update only from certain group: </label><br>" +
        '<select class="ui dropdown" data-id="' +
        search.id +
        '">' +
        (id == process.env.admin_id
          ? makegrupoption(id, search.id.toString(), searchdata)
          : "") +
        "</select>" +
        "</div>" +
        "</div>") +
    "</div>" +
    "</div>" +
    "</div>";
  return out;
}

function unfolmanga(id) {
  let _manga = editJsonFile("features/_dexmanga.json");
  return axios.get(
    "https://mangadex.org/ajax/actions.ajax.php?function=manga_unfollow&id=" +
      id +
      "&type=" +
      id,
    {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    }
  );
}

function folmanga(id) {
  return axios.get(
    "https://mangadex.org/ajax/actions.ajax.php?function=manga_follow&id=" +
      id +
      "&type=1",
    {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    }
  );
}

async function getmanga(id, fromcache = true) {
  if (fromcache) {
    if (myCache.has("manga-" + id)) {
      let out = myCache.get("manga-" + id);
      //out.cache = true;
      return out;
    }
  }
  let data = await axios.get(endpoint + "/manga/" + id + "?include=chapters", {
    headers: {
      Cookie: process.env.dex_cookies,
      "X-Requested-With": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
    }
  });
  myCache.set("manga-" + id, data.data.data);
  return data.data.data;
}

async function getsearch(q, fromcache = true) {
  if (fromcache) {
    if (myCache.has("search-" + q)) {
      let out = myCache.get("search-" + q);
      //out.cache = true;
      return out;
    }
  }
  let search = await mclient.search({
    title: q,
    with_hentai: false
  });
  myCache.set("search-" + q, search);
  return search;
}

async function getgroupname(id) {
  let grupdb = editJsonFile("db/_dexgroup.json");
  if (grupdb.get(id.toString())) {
    return grupdb.get(id.toString()).name;
  }
  let data = await axios.get(endpoint + "/group/" + id, {
    headers: {
      Cookie: process.env.dex_cookies,
      "X-Requested-With": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
    }
  });
  myCache.set("group-" + id, data.data.data);
  grupdb.set(id.toString() + ".name", data.data.data.name);
  grupdb.save();
  return data.data.data.name;
}

async function ambilfollow() {
  let tes = await axios.get(
    endpoint + "/user/" + process.env.dex_uid + "/followed-manga",
    {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    }
  );
  return tes.data.data;
}

function convertTZ(date, tzString) {
  return new Date(
    (typeof date === "string" ? new Date(date) : date).toLocaleString("en-US", {
      timeZone: tzString
    })
  );
}

// convert Date to string
function dateTodate(d) {
  let tgl = d.getDate() < 10 ? "0" + d.getDate() : d.getDate();
  let mon = d.getMonth() + 1 < 10 ? "0" + (d.getMonth() + 1) : d.getMonth() + 1;
  return tgl + "-" + mon + "-" + d.getFullYear();
}

function dateTohour(d) {
  let jam = d.getHours() < 10 ? "0" + d.getHours() : d.getHours();
  let mnt = d.getMinutes() < 10 ? "0" + d.getMinutes() : d.getMinutes();
  return jam + "." + mnt;
}

function datetostr(d) {
  return dateTodate(d) + " - " + dateTohour(d);
}

module.exports = app;
