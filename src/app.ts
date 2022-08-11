import { Client, Message, MessageEmbed, MessageOptions } from 'discord.js';
import dotenv from 'dotenv';
dotenv.config();

const client = new Client();

const prefix = process.env.PREFIX ?? 'p!';

if (!process.env.ROLE_SERVER) {
  throw new Error(`Role server id must be specified, use the 'ROLE_SERVER' env arg`);
}
if (!process.env.ROLE_WHITELIST) {
  throw new Error(
    `Whitelist role ids must be specified, use the 'ROLE_WHITELIST' env arg for a comma separated list`,
  );
}

const defaultRoleWhitelist = process.env.ROLE_WHITELIST.split(',');
const roleServer = process.env.ROLE_SERVER;

type CommandHandler = {
  name: string;
  description: string;
  args: string;
  roleWhitelist?: string[];
  handler: (content: string, message: Message) => Promise<void>;
};

const escapedChars: Record<string, string> = {
  r: '\r',
  n: '\n',
  t: '\t',
  '\\': '\\',
};

function readNextArg(content: string) {
  content = content.trim();
  if (content === '') {
    throw new CommandError('Not enough arguments');
  }
  if (content.startsWith('"')) {
    const chars: string[] = [];
    let len = 0;
    let escaped: boolean = false;

    for (let i = 1; i < content.length; i++) {
      len++;
      const char = content[i];

      if (escaped) {
        if (escapedChars[char]) {
          chars.push(escapedChars[char]);
        } else {
          chars.push(char);
        }
        escaped = false;
      } else {
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          break;
        }

        chars.push(char);
      }
    }

    const arg = chars.join('');
    return {
      arg,
      remainder: content.substr(len + 2),
    };
  } else {
    const match = content.match(/[^ \r\n]+/);
    const arg = match ? match[0] : content;
    return {
      arg,
      remainder: content.substr(arg.length + 1).trim(),
    };
  }
}

function readNextLine(content: string) {
  const match = content.match(/[^\r\n]+/m);
  if (content === '') {
    throw new CommandError('Not enough lines');
  }
  const line = match ? match[0] : content;
  return {
    line,
    remainder: content.substr(line.length + 1).trim(),
  };
}

type ArgStore = Record<string, () => Promise<void> | void>;
async function parseMessageAdvancedArgs(args: string, message: Message, original?: Message) {
  let remainder = args.trim();
  let content = '';
  let options: MessageOptions = {};

  const setContent = (c: string) => {
    checkSet('Content');
    content = c;
  };

  let alreadySet: Record<string, boolean> = {};
  const checkSet = (name: string) => {
    if (alreadySet[name]) {
      throw new CommandError(`${name} set more than once`);
    }
    alreadySet[name] = true;
  };

  const useArgsStore = async (store: ArgStore) => {
    while (remainder.length !== 0) {
      let nextArg;
      if (remainder.match(/^-\w/)) {
        ({ remainder, arg: nextArg } = readNextArg(remainder));
        nextArg = nextArg.substr(1);
      } else {
        nextArg = 'rest';
      }
      if (store[nextArg]) {
        await store[nextArg]();
      } else {
        throw new CommandError(`Argument ${nextArg} is unknown/unexpected here`);
      }
      remainder = remainder.trim();
    }
  };

  const argsStore = {
    ...(original && {
      ins: () => argsStore.insert!(),
      insert: () => {
        content = original.content;
        options = {
          embed: original.embeds[0],
        };
      },
    }),

    c: () => argsStore.content(),
    txt: () => argsStore.content(),
    text: () => argsStore.content(),
    content: () => {
      let txt;
      ({ remainder, arg: txt } = readNextArg(remainder));
      setContent(txt);
    },

    f: () => argsStore.attttachment(),
    att: () => argsStore.attttachment(),
    attttachment: () => {
      let url;
      ({ remainder, arg: url } = readNextArg(remainder));
      options.files = [...(options.files ?? []), url];
    },

    rest: () => {
      setContent(remainder);
      remainder = '';
    },

    embed: async () => {
      let embed = new MessageEmbed(options.embed);
      options.embed = embed;

      const setEmbedContent = (c: string) => {
        checkSet('Embed content');
        embed.setDescription(c);
      };

      const embedArgsStore = {
        title: () => {
          checkSet('Embed title');
          let title;
          ({ remainder, arg: title } = readNextArg(remainder));
          embed.setTitle(title);
        },

        footer: () => {
          checkSet('Embed footer');
          let footer;
          ({ remainder, arg: footer } = readNextArg(remainder));
          embed.setFooter(footer);
        },

        footerme: () => {
          checkSet('Embed footer');
          checkSet('Embed footer icon');
          embed.setFooter(
            message.member?.nickname ?? message.author.username,
            message.author.displayAvatarURL({ format: 'png' }) ?? undefined,
          );
        },

        footericon: () => {
          checkSet('Embed footer icon');
          if (!embed.footer) {
            throw new CommandError('Footer text needs to be set before the footer icon');
          }
          let url;
          ({ remainder, arg: url } = readNextArg(remainder));
          embed.setFooter(embed.footer.text, url);
        },

        author: () => {
          checkSet('Embed author');
          let author;
          ({ remainder, arg: author } = readNextArg(remainder));
          embed.setAuthor(author);
        },

        authorme: () => {
          checkSet('Embed author');
          checkSet('Embed author icon');
          embed.setAuthor(
            message.member?.nickname ?? message.author.username,
            message.author.displayAvatarURL({ format: 'png' }) ?? undefined,
          );
        },

        authoricon: () => {
          checkSet('Embed author icon');
          if (!embed.author) {
            throw new CommandError('author text needs to be set before the author icon');
          }
          let url;
          ({ remainder, arg: url } = readNextArg(remainder));
          embed.setAuthor(embed.author?.name, url);
        },

        time: () => {
          checkSet('Embed timestamp');
          let time;
          ({ remainder, arg: time } = readNextArg(remainder));
          let date: Date;
          try {
            if (time.toLowerCase() === 'now') {
              date = new Date();
            } else {
              date = new Date(time);
            }
          } catch {
            throw new CommandError(`Couldn't parse time "${time}"`);
          }
          embed.setTimestamp(date);
        },

        c: () => embedArgsStore.content(),
        txt: () => embedArgsStore.content(),
        text: () => embedArgsStore.content(),
        content: () => {
          let desc;
          ({ remainder, arg: desc } = readNextArg(remainder));
          setEmbedContent(desc);
        },

        url: () => {
          checkSet('Embed url');
          let url;
          ({ remainder, arg: url } = readNextArg(remainder));
          embed.setURL(parseUrl(url));
        },

        col: () => embedArgsStore.color(),
        color: () => {
          checkSet('Embed color');
          let col;
          ({ remainder, arg: col } = readNextArg(remainder));
          embed.setColor(col);
        },

        rest: () => {
          setEmbedContent(remainder);
          remainder = '';
        },
      };

      await useArgsStore(embedArgsStore);
    },
  };

  await useArgsStore(argsStore);

  return {
    content,
    options,
  };
}

async function parseChannel(data: string) {
  const match = data.match(/<#(\d+)>/);
  let id: string;
  if (match) {
    id = match[1];
  } else {
    id = data;
  }
  try {
    const r = await client.channels.fetch(id);
    return r;
  } catch {
    throw new CommandError(`Couldn't find channel with id "${id}"`);
  }
}

async function parseTextChannel(data: string) {
  const channel = await parseChannel(data);
  if (!channel.isText()) {
    throw new CommandError(`That channel isn't a text channel`);
  }
  return channel;
}

function parseUrl(data: string) {
  const match = data.match(/<(.+)>/);
  let url: string;
  if (match) {
    url = match[1];
  } else {
    url = data;
  }
  return url;
}

async function parseUser(data: string) {
  const match = data.match(/<@(\d+)>/);
  let id: string;
  if (match) {
    id = match[1];
  } else {
    id = data;
  }
  try {
    const r = await client.users.fetch(id);
    return r;
  } catch {
    throw new CommandError(`Couldn't find user with id "${id}"`);
  }
}

function cantSendEmptyMessageError() {
  return new CommandError("Can't send an empty message");
}

const commandLibrary: Record<string, CommandHandler> = {
  help: {
    name: 'Help',
    args: '',
    description: 'Display help',
    handler: async (content, msg) => {
      const helpString = [
        '*\\~\\~ **Command Help** \\~\\~*',
        '',
        Object.keys(commandLibrary)
          .map((key: keyof typeof commandLibrary) => {
            const command = commandLibrary[key];
            return [
              `\`${prefix}${key}\` - ${command.name}`,
              `*${command.description}*`,
              `\`\`\`${prefix}${key} ${command.args}\`\`\``,
            ].join('\n');
          })
          .join('\n'),
      ].join('\n');
      await msg.channel.send(helpString);
    },
  },
  send: {
    name: 'Send in the same channel',
    description: 'Send a message in the same channel, deleting the original',
    args: '<...content>',
    handler: async (content, msg) => {
      const channel = msg.channel;
      const attachments = msg.attachments.array();
      if (content.length === 0 && attachments.length === 0) throw cantSendEmptyMessageError();
      await channel.send(content, { files: attachments.map(f => f.url) });
      await msg.delete();
    },
  },
  sendc: {
    name: 'Send to channel',
    description: 'Send a message to a specified channel',
    args: '<channel> <...content>',
    handler: async (content, msg) => {
      let remainder: string = content.trim();

      let channelArg;
      ({ remainder, arg: channelArg } = readNextArg(remainder));
      const channel = await parseTextChannel(channelArg);

      const attachments = msg.attachments.array();
      if (remainder.length === 0 && attachments.length === 0) throw cantSendEmptyMessageError();
      await channel.send(remainder, { files: attachments.map(f => f.url) });
    },
  },
  sendu: {
    name: 'Send to user DM',
    description: "Send a message to a user's DMs",
    args: '<user> <...content>',
    handler: async (content, msg) => {
      let remainder: string = content.trim();

      let userArg;
      ({ remainder, arg: userArg } = readNextArg(remainder));
      const user = await parseUser(userArg);

      const attachments = msg.attachments.array();
      if (remainder.length === 0 && attachments.length === 0) throw cantSendEmptyMessageError();
      const channel = await user.createDM();
      await channel.send(remainder, { files: attachments.map(f => f.url) });
    },
  },
  ssend: {
    name: 'Advanced send',
    description: 'A fairly customizable send command for advanced messages',
    args: 'probably just ask leo about it',
    handler: async (content, msg) => {
      let channel = msg.channel;
      if (content.startsWith('<#')) {
        let channelArg;
        ({ remainder: content, arg: channelArg } = readNextArg(content));
        channel = await parseTextChannel(channelArg);
      }
      const { content: txt, options } = await parseMessageAdvancedArgs(content, msg);
      await channel.send(txt, options);
    },
  },
  sedit: {
    name: 'Advanced edit',
    description: 'A fairly customizable edit command for advanced edits',
    args: 'probably just ask leo about it',
    handler: async (content, msg) => {
      let arg1;
      let messageArg;
      let channel = msg.channel;

      ({ remainder: content, arg: arg1 } = readNextArg(content));
      if (arg1.startsWith('<#')) {
        channel = await parseTextChannel(arg1);
        ({ remainder: content, arg: messageArg } = readNextArg(content));
      } else {
        messageArg = arg1;
      }

      const message = await channel.messages.fetch(messageArg);
      const { content: txt, options } = await parseMessageAdvancedArgs(content, msg, message);
      message.edit(txt, options);
    },
  },
  news: {
    name: 'Send a news post',
    description: 'Generates an embed that is formatted as a general news post',
    args: '<channel> [title link] [color]\n<title>\n<...content>',
    handler: async (content, msg) => {
      let basicArgs;
      ({ remainder: content, line: basicArgs } = readNextLine(content));
      let title;
      ({ remainder: content, line: title } = readNextLine(content));

      let channelArg;
      ({ remainder: basicArgs, arg: channelArg } = readNextArg(basicArgs));

      let linkArg: string | undefined = undefined;
      if (basicArgs !== '') {
        ({ remainder: basicArgs, arg: linkArg } = readNextArg(basicArgs));
      }

      let colorArg: string | undefined = undefined;
      if (basicArgs !== '') {
        ({ remainder: basicArgs, arg: colorArg } = readNextArg(basicArgs));
      }

      const embed = new MessageEmbed()
        .setTitle(title)
        .setTimestamp(new Date())
        .setFooter('anime@UTS')
        .setAuthor(
          msg.member?.displayName ?? msg.author.username,
          msg.author.displayAvatarURL({ format: 'png' }),
        );

      if (linkArg !== undefined) {
        embed.setURL(parseUrl(linkArg));
      }

      embed.setDescription(content);

      embed.setColor(colorArg ?? '0099ff');

      const attachments = msg.attachments.array();
      if (attachments.length > 0) {
        embed.setImage(attachments[0].url);
      }

      const channel = await parseTextChannel(channelArg);
      channel.send(embed);
    },
  },
};

class CommandError extends Error {
  response: string;
  constructor(message: string) {
    super('An error occured in a command handler');
    this.response = message;
  }
}

client.on('ready', async () => {
  console.log('Logged in!');
});

client.on('message', async msg => {
  if (msg.author.bot) return;

  const content = msg.content;
  if (content.startsWith(prefix)) {
    const command = content.split(' ')[0].substr(prefix.length);
    if (commandLibrary[command]) {
      try {
        const comm = commandLibrary[command];
        const roleWhitelist = comm.roleWhitelist ?? defaultRoleWhitelist;
        const server = await client.guilds.fetch(roleServer);

        const author = await server.members.fetch(msg.author);
        if (!author) return;

        const foundRole = author.roles.cache.find(r => roleWhitelist.includes(r.id));
        if (!foundRole) return;

        await comm.handler(content.substr(command.length + prefix.length + 1), msg);
      } catch (e) {
        if (e instanceof CommandError) {
          await msg.channel.send(`Error: ${e.response}`);
        } else {
          await msg.channel.send(`An unknown error occured:\n${e}`);
          console.log(e);
        }
      }
    }
  }
});

client.login(process.env.TOKEN);
