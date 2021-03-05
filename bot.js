const express = require("express"),
  app = express.Router(),
  line = require("@line/bot-sdk"),
  xmlparser = require("fast-xml-parser"),
  editJsonFile = require("edit-json-file"),
  axios = require("axios"),
  { Mangadex } = require("mangadex-api"),
  cron = require("node-cron");

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
      console.log(e);
    });
});

const stat = require(__dirname + "/status");
const checker = stat.checker;
const closed = stat.closed;

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

// check dex update
async function getUpdate() {
  let file = editJsonFile("db/mangadex.json");
  let data = await axios.get(process.env.rss_url);
  let feed = xmlparser.parse(data.data).rss.channel.item;
  //let date = datetostr(convertTZ(new Date(feed[0].pubDate), "Asia/Jakarta"));
  let date = feed[0].pubDate;

  console.log("1 min mangadex has passed");

  if (file.get("latest") != date) {
    file.set("latest", date);
    file.save();
    console.log("mangadex updated");
    return dex(null, true);
  }
}

// check dex update v2
async function getUpdate2() {
  console.log("1 min mangadex has passed");
  let data = await axios.get(process.env.rss_url);
  let feed = xmlparser.parse(data.data).rss.channel.item;

  const db = editJsonFile("db/_dexmanga.json");
  let dbo = Object.keys(db.get());

  let getid = url => {
    return url.split("/")[url.split("/").length - 1];
  };

  for (let i = 0; i < dbo.length; i++) {
    if (Object.keys(db.get(dbo[i]).follower).length > 0) {
      if (!db.get(dbo[i]).latest) {
        db.set(dbo[i] + ".latest", "");
      }

      for (let j = 0; j < feed.length; j++) {
        if (getid(feed[j].mangaLink) == dbo[i]) {
          if (db.get(dbo[i]).latest != feed[j].pubDate) {
            db.set(dbo[i] + ".latest", feed[j].pubDate);
            db.save();
            console.log("Manga with id " + dbo[i] + " is just updated");

            // refresh cache
            await axios.get(
              "https://dex-line.glitch.me/api/cache/refresh/" + dbo[i]
            );
            // push update
            await pushUpdate(feed[j], Object.keys(db.get(dbo[i]).follower));
          }
          break;
        }
      }
    }
  }
}

async function pushUpdate(chapt, follower) {
  let userdb = editJsonFile("db/_dexuser.json");
  let grupdb = editJsonFile("db/_dexgroup.json");
  let getid = url => {
    return url.split("/")[url.split("/").length - 1];
  };
  let mangid = getid(chapt.mangaLink);
  let group = /Group: ([\d\D]*)\s-\sUploader/gi.exec(chapt.description)[1];
  for (let i in follower) {
    let usergroup = userdb.get(follower[i] + "." + mangid + ".group");
    if (usergroup != "-") {
      let grupname = grupdb.get(usergroup).name;
      if (group != grupname) {
        continue;
      }
    }
    let bubble = createdexbubble(chapt);
    let alttext = chapt.title;
    await push(follower[i], {
      type: "flex",
      altText: "Mangadex Update - " + alttext,
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
              type: "message",
              label: "Edit",
              text: "!edit"
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
  }
}

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

function reply(event, message) {
  try {
    return client.replyMessage(event.replyToken, message);
  } catch (e) {
    return Promise.resolve(null);
  }
}

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
    return Promise.resolve(null);
  }
}

function unfollowevent(event) {
  let userdb = editJsonFile("db/user.json");
  userdb.set(event.source.userId + ".block", true);
  userdb.save();
  return Promise.resolve(null);
}

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
      (event.source.userId == process.env.admin_id
        ? "• !dex2\n=> to see all following list in the account.\n\n"
        : "") +
      "• !edit\n=> to edit and see your following list.\n\n" +
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
            type: "message",
            label: "!edit",
            text: "!edit"
          }
        }
      ]
    }
  });
}

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
          if (!closed) {
            return dex(event);
          } else {
            return reply(event, {
              type: "text",
              text:
                "The mangadex updater will be turned off until mangadex is up again, sorry for the inconvenience.\n\nhttps://twitter.com/MangaDex/status/1366590814844055552"
            });
          }
        case "dex2":
          return event.source.userId == process.env.admin_id
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

  // edit bubble
  let editb = {
    type: "bubble",
    size: "micro",
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "button",
          action: {
            type: "uri",
            label: "Edit",
            uri: process.env.liff_url
          },
          height: "sm",
          margin: "sm",
          style: "secondary"
        }
      ],
      offsetTop: "80px"
    },
    styles: {
      header: {
        backgroundColor: "#ECEFF1"
      }
    }
  };

  // dex rss
  let data;
  let feed;

  try {
    data = await axios.get(process.env.rss_url);
    feed = xmlparser.parse(data.data).rss.channel.item;
  } catch (e) {
    return reply(event, {
      type: "text",
      text: "Failed to fetch data from mangadex.."
    });
  }

  if (_user.get(event.source.userId)) {
    let grupdb = editJsonFile("db/_dexgroup.json");
    let usermanga = Object.keys(_user.get(event.source.userId));
    let param = getparam(event.message.text);
    let bubbleandregex;
    for (let i = 0; i < feed.length; i++) {
      if (carousel.contents.length == 12) {
        break;
      }
      if (all) {
        bubbleandregex = handledexbubble(feed[i], param);
        if (bubbleandregex[0] != null) {
          carousel.contents.push(bubbleandregex[0]);
        }
      } else {
        let mangid = feed[i].mangaLink.split("/")[
          feed[i].mangaLink.split("/").length - 1
        ];
        for (let j = 0; j < usermanga.length; j++) {
          if (parseInt(usermanga[j]) == mangid) {
            if (
              _user.get(event.source.userId + "." + usermanga[j] + ".group") ==
              "-"
            ) {
              bubbleandregex = handledexbubble(feed[i], param);
              if (bubbleandregex[0] != null) {
                carousel.contents.push(bubbleandregex[0]);
              }
            } else {
              let grup = /Group: ([\d\D]*)\s-\sUploader/gi.exec(
                feed[i].description
              )[1];
              if (
                grup ==
                grupdb.get(
                  _user.get(event.source.userId + "." + usermanga[j] + ".group")
                ).name
              ) {
                bubbleandregex = handledexbubble(feed[i], param);
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
    //carousel.contents.push(editb);
    //console.log(JSON.stringify(carousel));

    let qr = {
      items: [
        {
          type: "action",
          action: {
            type: "message",
            label: "Edit",
            text: "!edit"
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
        if (regex.chap) {
          param = param.split(" -chapter ");
          out =
            "There is no manga that match with 「" +
            param[0] +
            "」 and chapter " +
            param[1].trim() +
            " in your following list.";
        } else {
          out =
            "There is no manga that match with 「" +
            param +
            "」 in your following list.";
        }
      } else {
        out =
          "You haven't followed any manga or there is no update based on your following list.";
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
        contents: carousel,
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

function handledexbubble(data, param) {
  let regex;
  let bubble;
  if (param != "") {
    regex = parseparam(param);
    if (regex.name.test(data.title)) {
      if (regex.chap) {
        if (regex.chap.test(data.title)) {
          bubble = createdexbubble(data);
        }
      } else {
        bubble = createdexbubble(data);
      }
    }
  } else {
    bubble = createdexbubble(data);
  }
  return [bubble, regex];
}

function createdexbubble(data) {
  let title = data.title;

  let chapter = title.split(" - ")[1];
  title = title.split(" - ")[0];

  let link = data.link;
  let date = dateTodate(convertTZ(new Date(data.pubDate), "Asia/Jakarta"));

  let group = data.description;
  group = group.split(" - ")[0];

  let regex = /Group: ([\d\D]*)/gi;
  group = regex.exec(group)[1];

  let lang = data.description;
  lang = lang.split(" - ");
  regex = /Language: ([\d\D]*)/gi;
  lang = regex.exec(lang)[1];

  let mangaurl = data.mangaLink;

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
          size: "xxs"
        }
      ],
      height: "100px"
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

function getparam(text) {
  let msg = text.split(" ");
  let h = "";
  for (let i = 1; i < msg.length; i++) {
    h += msg[i] + " ";
  }
  return h.split(" ") ? h.slice(0, -1) : h;
}

function parseparam(param) {
  let parse = param.split(" -chapter ");
  let regex = {
    name: null,
    chap: null
  };
  regex.name = new RegExp(parse[0], "i");
  if (parse.length > 1) {
    regex.chap = new RegExp("chapter " + parse[1].trim() + "$", "i");
  }
  return regex;
}

// convert timezone
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
  return dateTodate(d) + " " + dateTohour(d);
}

module.exports = app;
