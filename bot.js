const express = require("express"),
  app = express.Router(),
  line = require("@line/bot-sdk"),
  editJsonFile = require("edit-json-file"),
  axios = require("axios"),
  { Mangadex } = require("mangadex-api"),
  cron = require("node-cron"),
  mangadexapi = require("./utility/mangadex.js");

const config = {
    channelAccessToken: process.env.acc_token,
    channelSecret: process.env.acc_secret
  },
  client = new line.Client(config),
  mclient = new Mangadex();

app.post("/callback", line.middleware(config), (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then(result => res.json(result))
    .catch(e => {
      // console.log(e);
      console.log("Error when sending request to LINE");
    });
});

const util = require("./utility");
const checker = util.checker;
const closed = util.closed;

// check manga every minute
cron.schedule("* * * * *", async () => {
  try {
    // await getUpdate();

    // using update check v2
    if (!closed && checker) {
      await getUpdate2();
    }
  } catch (e) {
    let log = "Failed to fetch data from mangadex";
    if (e.response) {
      log += " with error code " + e.response.status;
    }
    console.log(log);
  }
});

// check dex update v2
async function getUpdate2() {
  console.log("1 min mangadex has passed");

  const db = editJsonFile("db/_dexmanga.json");

  let data = await getuserfollowing();
  let chapters = data.chapters;
  let dbo = Object.keys(db.get());

  for (let i = 0; i < dbo.length; i++) {
    if (Object.keys(db.get(dbo[i]).follower).length > 0) {
      if (!db.get(dbo[i]).latest) {
        db.set(dbo[i] + ".latest", "");
      }

      for (let j = 0; j < chapters.length; j++) {
        if (chapters[j].mangaId.toString() == dbo[i]) {
          let mangdate = pubDate(new Date(chapters[j].timestamp * 1000));
          let temp = db.get(dbo[i]).latest;
          if (db.get(dbo[i]).latest != mangdate) {
            db.set(dbo[i] + ".latest", mangdate);
            console.log("Manga with id " + dbo[i] + " is just updated");
            try {
              // refresh cache
              let cache = await axios.get(
                "https://dex-line.glitch.me/api/cache/refresh/" + dbo[i]
              );
              db.save();
              // push update
              await pushUpdate(
                data,
                j,
                Object.keys(db.get(dbo[i]).follower),
                cache.data
              );
            } catch (e) {
              //db.set(dbo[i] + ".latest", temp);
              //db.save();
              console.log(
                "Update manga with id " +
                  dbo[i] +
                  " is reverted because of request error, will try again in one minute"
              );
            }
          }
          break;
        }
      }
    }
  }
}

/*
@param
- feed = data from getuserfollowing(), object
- idx = idx of feed.chapters, integer
- follower = array of string (follower id)
- data = manga data from cache, object
*/
async function pushUpdate(feed, idx, follower, data) {
  let userdb = editJsonFile("db/_dexuser.json");

  let chapter = feed.chapters[idx];
  let mangid = chapter.mangaId;
  let grupupdateid = data.chapters.find(c => c.id == chapter.id).groups[0];

  for (let i in follower) {
    let usergroup = userdb.get(follower[i] + "." + mangid + ".group");
    if (usergroup != "-") {
      if (parseInt(usergroup) != grupupdateid) {
        continue;
      }
    }
    let bubble = dynamicheight(createdexbubble(chapter, feed.groups), true);

    let alttext =
      chapter.mangaTitle +
      " - Chapter " +
      chapter.chapter +
      (chapter.title ? " - " + chapter.title : "");

    let pushres = await push(follower[i], {
      type: "flex",
      altText: alttext,
      contents: bubble,
      sender: {
        name: "MangaDex Update",
        iconUrl: "https://mangadex.org/favicon-192x192.png"
      },
      quickReply: {
        items: [
          {
            type: "action",
            action: {
              type: "uri",
              label: "Edit",
              uri: process.env.liff_url
            }
          },
          {
            type: "action",
            action: {
              type: "message",
              label: "List",
              text: "!dex"
            }
          }
        ]
      }
    });
    if (pushres) {
      console.log(
        "Manga update with id " +
          mangid +
          " is just pushed to user with id " +
          follower[i]
      );
    } else {
      console.log("Failed to push message to user with id " + follower[i]);
    }
  }
}

/*
@param
- event = LINE webhooks data, object
*/
async function handleEvent(event) {
  let type = event.type;

  switch (type) {
    case "follow":
      return followevent(event);
    case "unfollow":
      return unfollowevent(event);
    case "message":
      return event.message.text ? parsemessage(event) : Promise.resolve(null);
  }
}

/*
@param
- event = LINE webhooks data, object
- message = message object
*/
function reply(event, message) {
  try {
    return client.replyMessage(event.replyToken, message);
  } catch (e) {
    return Promise.resolve(null);
  }
}

/*
@param
- id = user id, string
- message = message object
*/
async function push(id, message) {
  try {
    let push = await client.pushMessage(id, message);
    let quota = editJsonFile("db/pushlimit.json");
    let month = convertTZ(new Date(), "Asia/Jakarta").getMonth() + 1;

    if (quota.get("month") != month) {
      let kuota = 500;

      let data = quota.get("data");
      data.push(kuota - quota.get("quota"));
      quota.set("data", data);
      quota.set("month", month);
      quota.set("quota", kuota);
    }
    quota.set("quota", quota.get("quota") - 1);
    quota.save();

    return push;
  } catch (e) {
    console.log(e);
    return Promise.resolve(null);
  }
}

/*
@param
- event = LINE webhooks data, object
*/
function unfollowevent(event) {
  let userdb = editJsonFile("db/user.json");
  userdb.set(event.source.userId + ".block", true);
  userdb.save();
  return Promise.resolve(null);
}

/*
@param
- event = LINE webhooks data, object
*/
async function followevent(event) {
  await isadded(event);
  return reply(event, {
    type: "text",
    text:
      "Welcome to Mangadex Notifier for LINE!\n\n" +
      "Available command: \n" +
      "• !dex\n=> to open your following list latest chapter update.\n" +
      "• !dex manga_name\n=> to open your following list with manga name (e.g. !dex kubo-san).\n" +
      "• !dex manga_name -chapter num\n=> to open your following list with manga name and certain chapter (e.g. !dex kubo-san -chapter 20).\n\n" +
      (isAdmin(event.source.userId)
        ? "• !dex2\n=> to see all following list in the account.\n\n"
        : "") +
      "• !edit \n=> to edit and see your following list.\n\n" +
      "If you find any problem, please make an issue at https://github.com/raf555/mangadex-updater-line",
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "!dex",
            text: "!dex"
          }
        },
        {
          type: "action",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          }
        }
      ]
    }
  });
}

/*
@param
- event = LINE webhooks data, object
*/
async function parsemessage(event) {
  let textarr = event.message.text.split(" ");
  let text = textarr[0];
  let sign = text[0];
  let cmd = text.toLowerCase().substring(1);
  let added = await isadded(event);

  if (sign == "!") {
    if (added) {
      switch (cmd) {
        case "dex":
          if (!closed || (closed && isAdmin(event.source.userId))) {
            return dex(event);
          } else {
            return reply(event, {
              type: "text",
              text:
                "The mangadex updater will be turned off until mangadex is up again, sorry for the inconvenience." +
                "\n\nhttps://mangadex.org/index.html"
            });
          }
        case "dex2":
          return isAdmin(event.source.userId)
            ? dex(event, true)
            : Promise.resolve(null);
        case "edit":
          return edit(event);
        default:
          return Promise.resolve(null);
      }
    } else {
      return reply(event, {
        type: "text",
        text: "You haven't added bot yet, please add bot first."
      });
    }
  }
}

/*
@param
- event = LINE webhooks data, object
*/
async function isadded(event) {
  let userdb = editJsonFile("db/user.json");
  let added = false;
  try {
    let userdata = await client.getProfile(event.source.userId);
    // for now, limit total user that can be registered
    let userlimit = 999;
    if (Object.keys(userdb.get()).length <= userlimit) {
      userdb.set(userdata.userId + ".name", userdata.displayName);
      userdb.set(userdata.userId + ".pic", userdata.pictureUrl);
      userdb.set(userdata.userId + ".block", false);
      userdb.save();
      added = true;
    }
  } catch (e) {
    added = false;
  }

  return added;
}

/*
@param
- event = LINE webhooks data, object
*/
function edit(event) {
  let bubble = {
    type: "bubble",
    size: "nano",
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          },
          style: "primary"
        }
      ]
    }
  };
  return reply(event, {
    type: "flex",
    altText: "Edit Manga",
    contents: bubble,
    quickReply: {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "List",
            text: "!dex"
          }
        }
      ]
    }
  });
}

/*
@param
- event = LINE webhooks data, object
- all = boolean
*/
async function dex(event, all) {
  // MANGADEX

  // database
  let _manga = editJsonFile(`db/_dexmanga.json`);
  let _user = editJsonFile(`db/_dexuser.json`);

  // carousel
  let carousel = {
    type: "carousel",
    contents: []
  };

  // dex latest data
  let data;

  try {
    data = await getuserfollowing();
  } catch (e) {
    return reply(event, {
      type: "text",
      text: "Failed to fetch data from mangadex.."
    });
  }

  if (_user.get(event.source.userId)) {
    let usermanga = Object.keys(_user.get(event.source.userId));
    let param = getparam(event.message.text);
    let bubbleandregex;
    let feed = data.chapters;
    for (let i = 0; i < feed.length; i++) {
      if (carousel.contents.length == 12) {
        break;
      }
      if (all) {
        bubbleandregex = handledexbubble(data, i, param);
        if (bubbleandregex[0] != null) {
          carousel.contents.push(bubbleandregex[0]);
        }
      } else {
        let mangid = feed[i].mangaId;
        for (let j = 0; j < usermanga.length; j++) {
          if (parseInt(usermanga[j]) == mangid) {
            if (
              _user.get(event.source.userId + "." + usermanga[j] + ".group") ==
              "-"
            ) {
              bubbleandregex = handledexbubble(data, i, param);
              if (bubbleandregex[0] != null) {
                carousel.contents.push(bubbleandregex[0]);
              }
            } else {
              let grup = feed[i].groups[0].toString();
              if (
                grup ==
                _user.get(event.source.userId + "." + usermanga[j] + ".group")
              ) {
                bubbleandregex = handledexbubble(data, i, param);
                if (bubbleandregex[0] != null) {
                  carousel.contents.push(bubbleandregex[0]);
                }
              }
            }
            break;
          }
        }
      }
    }
    //console.log(JSON.stringify(carousel));

    let qr = {
      items: [
        {
          type: "action",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          }
        },
        {
          type: "action",
          imageUrl: "https://mangadex.org/favicon-192x192.png",
          action: {
            type: "message",
            label: "Refresh",
            text: "!dex"
          }
        }
      ]
    };

    if (carousel.contents.length == 0) {
      let out;
      let regex = bubbleandregex[1];
      if (regex.name) {
        param = param.split(" -chapter ");
        out = "There is no manga that match with 「" + param[0] + "」 ";
        if (regex.chap) {
          out += "and chapter " + param[1].trim();
        }
        out += " in your latest following list.";
      } else {
        out =
          "You haven't followed any manga or there is no update based on our latest list.";
      }
      return reply(event, {
        type: "text",
        text: out,
        sender: {
          name: "MangaDex Update",
          iconUrl: "https://mangadex.org/favicon-192x192.png"
        },
        quickReply: qr
      });
    }

    let arrrep = [
      {
        type: "flex",
        altText: "Mangadex Update",
        contents: dynamicheight(carousel),
        sender: {
          name: "MangaDex Update",
          iconUrl: "https://mangadex.org/favicon-192x192.png"
        },
        quickReply: qr
      }
    ];

    /*if (!checker) {
      arrrep.push({
        type: "text",
        text:
          "Update checker is disabled to help Mangadex recover, sorry for the inconvenience."
      });
    }*/

    return reply(event, arrrep);
  } else {
    return reply(event, {
      type: "text",
      text: "You haven't followed any manga."
    });
  }
}

/*
@param
- data = bubble / carousel, object
- isbubble = boolean
*/
function dynamicheight(data, isbubble) {
  /* https://stackoverflow.com/questions/14484787/wrap-text-in-javascript */
  const wraptext = (s, w) =>
    s.replace(
      new RegExp(`(?![^\\n]{1,${w}}$)([^\\n]{1,${w}})\\s`, "g"),
      "$1\n"
    );

  if (isbubble) {
    data = { type: "carousel", contents: [data] };
  }

  let height = [];
  for (let i in data.contents) {
    let title = data.contents[i].header.contents[0].text;
    let chapt = data.contents[i].header.contents[1].text;

    //console.log(wraptext(title.replace(/-/g, " ").replace(/\//g, " / "), 17));

    let wraptitlelength =
      wraptext(title.replace(/-/g, " ").replace(/\//g, " / "), 17).split(
        /\r\n|\r|\n/
      ).length * 20;
    let wrapchaptlength = wraptext(chapt, 27).split(/\r\n|\r|\n/).length * 20;

    if (wraptitlelength == 20) wraptitlelength = 25;
    if (wrapchaptlength == 20) wrapchaptlength = 25;

    height.push(wraptitlelength + wrapchaptlength);
  }

  let maxheight = Math.max(...height);

  for (let i = 0; i < data.contents.length; i++) {
    data.contents[i].header.height = maxheight + "px";
  }

  return !isbubble ? data : data.contents[0];
}

/*
@param
- data = data from getuserfollowing(), object
- i = chapter index, integer
- param = string
*/
function handledexbubble(data, i, param) {
  let filtering;
  let bubble;
  let chapter = data.chapters[i];
  if (param != "") {
    filtering = parseparam(param);
    if (filtering.name.test(chapter.mangaTitle)) {
      if (filtering.chap) {
        if (chapter.chapter == filtering.chap) {
          bubble = createdexbubble(chapter, data.groups);
        }
      } else {
        bubble = createdexbubble(chapter, data.groups);
      }
    }
  } else {
    bubble = createdexbubble(chapter, data.groups);
  }
  return [bubble, filtering];
}

/*
@param
- data = data chapters, object
- groupdata = data group, object
*/
function createdexbubble(data, groupdata) {
  let title = data.mangaTitle;
  let mangaurl = "https://mangadex.org/title/" + data.mangaId;
  let chapter =
    "Chapter " + data.chapter + (data.title ? " - " + data.title : "");
  let date = datetostr(
    convertTZ(new Date(data.timestamp * 1000), "Asia/Jakarta"),
    false
  );
  let lang = "English";
  let group = groupdata.filter(grup => grup.id == data.groups[0])[0].name;
  let link = "https://mangadex.org/chapter/" + data.id;

  return {
    type: "bubble",
    size: "micro",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "" + title,
          weight: "bold",
          size: "sm",
          wrap: true,
          action: {
            type: "uri",
            label: "open",
            uri: "" + mangaurl
          }
        },
        {
          type: "text",
          text: "" + chapter,
          size: "xxs",
          wrap: true
        }
      ],
      height: "120px"
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "box",
              layout: "horizontal",
              spacing: "sm",
              contents: [
                {
                  type: "text",
                  text: "Date",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + date,
                  size: "xxs",
                  align: "end"
                }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Language",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + lang,
                  size: "xxs",
                  align: "end",
                  wrap: true
                }
              ]
            },
            {
              type: "box",
              layout: "horizontal",
              contents: [
                {
                  type: "text",
                  text: "Group",
                  wrap: true,
                  color: "#8c8c8c",
                  size: "xxs"
                },
                {
                  type: "text",
                  text: "" + group,
                  size: "xxs",
                  align: "end",
                  wrap: true
                }
              ]
            }
          ]
        }
      ],
      spacing: "sm",
      paddingAll: "13px"
      //justifyContent: "center"
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "separator"
        },
        {
          type: "button",
          action: {
            type: "uri",
            label: "open",
            uri: "" + link
          },
          height: "sm",
          margin: "sm",
          style: "secondary"
        }
      ]
    },
    styles: {
      header: {
        backgroundColor: "#ECEFF1"
      }
    }
  };
}

async function getuserfollowing() {
  return await mangadexapi.getfollowing();
}

/*
@param
- text = string
*/
function getparam(text) {
  let msg = text.split(" ");
  let h = "";
  for (let i = 1; i < msg.length; i++) {
    h += msg[i] + " ";
  }
  return h.split(" ") ? h.slice(0, -1) : h;
}

/*
@param
- param = string
*/
function parseparam(param) {
  let parse = param.split(" -chapter ");
  let regex = {
    name: null,
    chap: null
  };
  regex.name = new RegExp(parse[0], "i");
  /*if (parse.length > 1) {
    regex.chap = new RegExp("chapter " + parse[1].trim() + "$", "i");
  }*/
  if (parse.length > 1) {
    regex.chap = parse[1].trim();
  }
  return regex;
}

// convert timezone
function convertTZ(date, tzString) {
  return util.convertTZ(date, tzString);
}

// convert Date to string
function dateTodate(d) {
  return util.dateTodate(d);
}

function dateTohour(d) {
  return util.dateTohour(d);
}

function datetostr(d, jam = true) {
  return util.datetostr(d, jam);
}

function isAdmin(id) {
  return util.isAdmin(id);
}

function pubDate(d) {
  return util.pubDate(d);
}

module.exports = app;
