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

// check manga every minute
cron.schedule("* * * * *", async () => {
  try {
    await getUpdate();
  } catch (e) {
    console.log("Failed to fetch data from mangadex");
  }
});

// check dex update
async function getUpdate() {
  let file = editJsonFile("db/mangadex.json");
  let data = await axios.get(process.env.rss_url);
  let feed = xmlparser.parse(data.data).rss.channel.item;
  let date = datetostr(convertTZ(new Date(feed[0].pubDate), "Asia/Jakarta"));

  console.log("1 min mangadex has passed");

  if (file.get("latest") != date) {
    file.set("latest", date);
    file.save();
    console.log("mangadex updated");
    return dex(null, true);
  }
}

async function handleEvent(event) {
  let type = event.type;

  switch (type) {
    case "follow":
      return followevent(event);
    case "message":
      return event.message.text ? parse(event) : Promise.resolve(null);
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
      quota.set("month", month);
      quota.set("quota", 500);
    }
    quota.set("quota", quota.get("quota") - 1);
    quota.save();

    return push;
  } catch (e) {
    return Promise.resolve(null);
  }
}

async function followevent(event) {
  await isadded(event);
  return reply(event, {
    type: "text",
    text:
      "Welcome to (Unofficial) Mangadex Notifier for LINE!\n\n" +
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

async function parse(event) {
  let textarr = event.message.text.split(" ");
  let text = textarr[0];
  let sign = text[0];
  let cmd = text.toLowerCase().substring(1);
  let added = await isadded(event);

  if (sign == "!") {
    if (added) {
      switch (cmd) {
        case "dex":
          return dex(event);
        case "dex2":
          return event.source.userId == process.env.admin_id
            ? dex(event, null, true)
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
    let userlimit = 15;
    if (Object.keys(userdb.get()).length <= userlimit) {
      userdb.set(userdata.userId + ".name", userdata.displayName);
      userdb.set(userdata.userId + ".pic", userdata.pictureUrl);
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

async function dex(event, pushh, all) {
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

  if (!pushh) {
    if (_user.get(event.source.userId)) {
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
              bubbleandregex = handledexbubble(feed[i], param);
              if (bubbleandregex[0] != null) {
                carousel.contents.push(bubbleandregex[0]);
              }
              break;
            }
          }
        }
      }
      //carousel.contents.push(editb);
      //console.log(JSON.stringify(carousel));

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
          text: out
        });
      }

      return reply(event, {
        type: "flex",
        altText: "Mangadex Update",
        contents: carousel,
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
              imageUrl: "https://mangadex.org/favicon-192x192.png",
              action: {
                type: "message",
                label: "Refresh",
                text: "!dex"
              }
            }
          ]
        }
      });
    } else {
      return reply(event, {
        type: "text",
        text: "You haven't followed any manga."
      });
    }
  } else {
    let apdetid = feed[0].mangaLink.split("/")[
      feed[0].mangaLink.split("/").length - 1
    ];
    let user = _manga.get(apdetid + ".follower");
    let alttext = "";

    if (user) {
      let userdata = Object.keys(user);
      for (let k = 0; k < userdata.length; k++) {
        let usermanga = Object.keys(_user.get(userdata[k]));
        for (let i = 0; i < feed.length; i++) {
          if (carousel.contents.length == 11) {
            break;
          }
          let mangid = feed[i].mangaLink.split("/")[
            feed[i].mangaLink.split("/").length - 1
          ];
          for (let j = 0; j < usermanga.length; j++) {
            if (parseInt(usermanga[j]) == mangid) {
              let bubble = createdexbubble(feed[i]);
              carousel.contents.push(bubble);
              alttext = feed[i].title;
              break;
            }
          }

          break; // show only one bubble when update
        }
        //carousel.contents.push(editb);

        if (carousel.contents.length == 0) {
          return push(userdata[k], {
            type: "text",
            text:
              "You haven't followed any manga or there is no update based on your following list."
          });
        } else {
          return push(userdata[k], {
            type: "flex",
            altText: "Mangadex Update - " + alttext,
            contents: carousel,
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
                    label: "List",
                    text: "!dex"
                  }
                },
                {
                  type: "action",
                  action: {
                    type: "message",
                    label: "Edit",
                    text: "!edit"
                  }
                }
              ]
            }
          });
        }
      }
    }
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
