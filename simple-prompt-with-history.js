const keyListeners = {},
  exitListeners = {},
  fs = require('fs').promises;
let nextTmpListener = 1;

Object.assign(exports, {
  prompt,
  setKeyListener: (l, name = `tmpListener#${nextTmpListener++}`) => {
    keyListeners[name] = l;
    return name;
  },
  setExitListener: (l, name = `tmpListener#${nextTmpListener++}`) => {
    exitListeners[name] = l;
    return name;
  },
  removeKeyListener: name => {
    delete keyListeners[name];
  },
  removeExitListener: name => {
    delete exitListeners[name];
  }
});

const stdin = process.stdin,
  stdout = process.stdout;
stdin.setEncoding('utf8');
stdin.setRawMode(true);
stdin.resume();

stdin.on('data', key => {
  if (key === '\u0003') {
    exit();
    return;
  }
  for (const l of Object.values(keyListeners)) l(key);
});

const prompts = {};

async function loadPrompt(promptInfo = 'default') {
  if (typeof promptInfo == 'string') promptInfo = { name: promptInfo };

  if (typeof promptInfo.name != 'string') promptInfo.name = `sess-${Object.keys(prompts).length}`;
  if (prompts[promptInfo.name] !== promptInfo) {
    const promptEntries = Object.entries(prompts),
      foundAt = promptEntries.findIndex(([_name, info]) => info === promptInfo);
    if (foundAt != -1) delete prompts[promptEntries[foundAt][0]];
    if (prompts[promptInfo.name]) promptInf = Object.assign(prompts[promptInfo.name], promptInfo);
    else prompts[promptInfo.name] = promptInfo;
  }

  if (typeof promptInfo.persist != 'boolean') promptInfo.persist = true;
  if (typeof promptInfo.msg != 'string') promptInfo.msg = `${promptInfo.name == 'default' ? '' : promptInfo.name}# `;
  if (typeof promptInfo.fn != 'string') promptInfo.fn = `${promptInfo.name}-history.json`;

  if (!Array.isArray(promptInfo.values)) {
    delete promptInfo.valueIndex;

    if (promptInfo.persist && fs.exists(promptInfo.fn)) {
      promptInfo.values = JSON.parse(await fs.readFile(promptInfo.fn, 'UTF8'));
    } else {
      promptInfo.values = [];
    }
  }

  return promptInfo;
}

async function savePrompt(promptInfo = 'default') {
  promptInfo = loadPrompt(promptInfo);
  if (!promptInfo.persist) return;
  await fs.writeFile(prompt.fn, JSON.stringify(prompt.values));
}

async function saveAllPrompts() {
  await Promise.all(Object.values(prompts).map(savePrompt));
}

async function exit() {
  let saveError;
  saveAllPrompts()
    .catch(error => {
      saveError = error;
    })
    .finally(() => {
      let doExit = true;
      for (const l of Object.values(exitListeners)) {
        if (l(saveError) === false) doExit = false;
      }
      if (doExit) process.exit();
    });
}

async function prompt(promptInfo = 'default') {
  const { msg, values, onUp, onDown, onTab } = (promptInfo = await loadPrompt(promptInfo));

  stdout.write(msg);

  let drawnValue = '';

  function getValue() {
    if (promptInfo.valueIndex < 0) promptInfo.valueIndex = 0;
    if (promptInfo.valueIndex === undefined || promptInfo.valueIndex >= values.length) {
      if (!values.length || values[values.length - 1].length) values.push('');
      promptInfo.valueIndex = values.length - 1;
    }
    return String(values[promptInfo.valueIndex]);
  }

  function redraw() {
    const value = getValue();
    let commonPrefixLength = 0;
    while (
      commonPrefixLength < drawnValue.length &&
      commonPrefixLength < value.length &&
      value.charAt(commonPrefixLength) == drawnValue.charAt(commonPrefixLength)
    )
      commonPrefixLength++;
    stdout.write('\b \b'.repeat(drawnValue.length - commonPrefixLength) + value.substring(commonPrefixLength));
    drawnValue = value;
  }
  redraw();

  return await new Promise(onEnter => {
    keyListeners.prompt = key => {
      switch (key) {
        case '\t':
          if (onTab) {
            onTab(promptInfo);
            redraw();
          }
          break;
        case '\u001b[A':
          if (onUp) onUp(promptInfo);
          else promptInfo.valueIndex--;
          redraw();
          break;
        case '\u001b[B':
          if (onUp) onDown(promptInfo);
          else promptInfo.valueIndex++;
          redraw();
          break;
        case '\r': {
          stdout.write('\n');
          const value = getValue();
          if (promptInfo.onEnter) {
            if (promptInfo.onEnter(promptInfo) === false) break;
          } else {
            delete promptInfo.valueIndex;
          }
          delete keyListeners.prompt;
          if (promptInfo.eagerSaving) savePrompt(promptInfo).then(() => onEnter(value));
          else onEnter(value);
          break;
        }
        case String.fromCharCode(127): {
          const value = getValue();
          if (value.length) {
            if (promptInfo.valueIndex < values.length - 1) {
              promptInfo.valueIndex = values.length - (values[values.length - 1] == '' ? 1 : 0);
            }
            values[promptInfo.valueIndex] = value.substring(0, value.length - 1);
            redraw();
          }
          break;
        }
        default:
          if (key.length != 1 || key.charCodeAt(0) < 0x20) break;
          const value = getValue();
          if (promptInfo.valueIndex < values.length - 1) {
            promptInfo.valueIndex = values.length - (values[values.length - 1] == '' ? 1 : 0);
          }
          values[promptInfo.valueIndex] = value + key;
          redraw();
          break;
      }
    };
  });
}
