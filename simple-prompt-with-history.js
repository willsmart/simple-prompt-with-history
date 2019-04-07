// simple-prompt-with-history node package
// see https://github.com/willsmart/simple-prompt-with-history
// Author: Will Smart
// Licence: MIT
//
// More documentation to come but essentially at the minimal end, use like:
/*

const prompt = require('simple-prompt-with-history');

prompt().then(command=>console.log(`Do this: ${command}`))

*/
// and as a more full example
/*

const {prompt, loadPrompt} = require('simple-prompt-with-history');

(async function(){
  // Set up the prompts
  await loadPrompt({
    name: 'default',
    fn: 'somepath/prompt-history-filename.json',
    eagerSave: true, // save the history file after each command
    msg: 'Please enter a command: '
  })
  await loadPrompt({
    name: 'files',
    persist: false,
    msg: 'Please enter a filename: '
  })

  const
    command1 = await prompt(),
    filename = await prompt('files'),
    command2 = await prompt(),
    command2 = await prompt()
})()
*/

const keyListeners = {},
  exitListeners = {},
  fs = require('fs').promises;
let nextTmpListener = 1;

module.exports = prompt;
Object.assign(prompt, {
  prompt,
  loadPrompt,
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
    if (prompts[promptInfo.name]) promptInfo = Object.assign(prompts[promptInfo.name], promptInfo);
    else prompts[promptInfo.name] = promptInfo;
  }

  if (typeof promptInfo.persist != 'boolean') promptInfo.persist = true;
  if (typeof promptInfo.msg != 'string') promptInfo.msg = `${promptInfo.name == 'default' ? '' : promptInfo.name}# `;
  if (typeof promptInfo.fn != 'string') promptInfo.fn = `${promptInfo.name}-history.json`;

  if (!Array.isArray(promptInfo.values)) {
    delete promptInfo.valueIndex;
    promptInfo.values = [];

    if (promptInfo.persist) {
      do {
        try {
          await fs.access(promptInfo.fn);
        } catch (err) {
          break;
        }
        try {
          promptInfo.values = JSON.parse(await fs.readFile(promptInfo.fn, 'UTF8'));
        } catch (err) {
          console.log(`Error while parsing history file '${promptInfo.fs}':\n${err.message}`);
        }
      } while (0);
    }
  }

  return promptInfo;
}

async function savePrompt(promptInfo = 'default') {
  promptInfo = await loadPrompt(promptInfo);
  if (!promptInfo.persist) return;
  await fs.writeFile(promptInfo.fn, JSON.stringify(promptInfo.values));
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

async function prompt(promptInfo = '') {
  if (typeof promptInfo == 'string') promptInfo = { q: promptInfo, name: 'default' };
  const { q } = promptInfo;
  delete promptInfo.q;
  const { msg, values, onUp, onDown, onTab } = (promptInfo = await loadPrompt(promptInfo));

  stdout.write(msg + (q || ''));

  let drawnValue = '',
    drawnCharIndex = 0;

  function getValue() {
    if (promptInfo.valueIndex < 0) promptInfo.valueIndex = 0;
    if (promptInfo.valueIndex === undefined || promptInfo.valueIndex >= values.length) {
      if (!values.length || values[values.length - 1].length) values.push('');
      promptInfo.valueIndex = values.length - 1;
    }
    promptInfo.value = String(values[promptInfo.valueIndex]);
    if (typeof promptInfo.charIndex != 'number' || promptInfo.charIndex > promptInfo.value.length) {
      promptInfo.charIndex = promptInfo.value.length;
    }
    if (promptInfo.charIndex < 0) promptInfo.charIndex = 0;
    return promptInfo.value;
  }

  function moveDrawnCharIndex(to) {
    if (to > drawnCharIndex) {
      stdout.write('\u001b[C'.repeat(to - drawnCharIndex));
    } else if (to < drawnCharIndex) {
      stdout.write('\u001b[D'.repeat(drawnCharIndex - to));
    }
    drawnCharIndex = to;
  }

  function redraw() {
    const value = getValue();
    if (value == drawnValue && promptInfo.charIndex == drawnCharIndex) return;

    if (value != drawnValue) {
      moveDrawnCharIndex(drawnValue.length);

      let commonPrefixLength = 0;
      while (
        commonPrefixLength < drawnValue.length &&
        commonPrefixLength < value.length &&
        value.charAt(commonPrefixLength) == drawnValue.charAt(commonPrefixLength)
      ) {
        commonPrefixLength++;
      }
      stdout.write('\b \b'.repeat(drawnValue.length - commonPrefixLength) + value.substring(commonPrefixLength));
      drawnValue = value;
      drawnCharIndex = value.length;
    }

    moveDrawnCharIndex(promptInfo.charIndex);
  }

  redraw();

  return await new Promise(onEnter => {
    keyListeners.prompt = key => {
      switch (key) {
        case '\t':
          if (onTab) {
            getValue();
            const newValue = onTab(promptInfo);
            if (typeof newValue == 'string') {
              getValue();
              values[promptInfo.valueIndex] = newValue;
            }
            redraw();
            return;
          }
          key = ' ';
          break;

        case '\u001b[A': //up
          if (onUp) {
            getValue();
            const newValue = onUp(promptInfo);
            if (typeof newValue == 'string') {
              getValue();
              values[promptInfo.valueIndex] = newValue;
            }
          } else {
            promptInfo.valueIndex--;
            delete promptInfo.charIndex;
          }
          redraw();
          return;

        case '\u001b[B': //down
          if (onUp) {
            getValue();
            const newValue = onDown(promptInfo);
            if (typeof newValue == 'string') {
              getValue();
              values[promptInfo.valueIndex] = newValue;
            }
          } else {
            promptInfo.valueIndex++;
            delete promptInfo.charIndex;
          }
          redraw();
          return;

        case '\u001b[D': //left
          if (promptInfo.charIndex > 0) {
            promptInfo.charIndex--;
            redraw();
          }
          return;

        case '\u001b[C': //right
          const value = getValue();
          if (promptInfo.charIndex < value.length) {
            promptInfo.charIndex++;
            redraw();
          }
          return;

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
          return;
        }

        case String.fromCharCode(127): {
          const value = getValue();
          if (promptInfo.charIndex > 0) {
            if (promptInfo.valueIndex < values.length - 1) {
              promptInfo.valueIndex = values.length - (values[values.length - 1] == '' ? 1 : 0);
            }
            values[promptInfo.valueIndex] =
              value.substring(0, promptInfo.charIndex - 1) + value.substring(promptInfo.charIndex);
            promptInfo.charIndex--;
            redraw();
          }
          return;
        }
      }

      if (key != '\t' && (key.length != 1 || key.charCodeAt(0) < 0x20)) return;

      const value = getValue();
      if (promptInfo.valueIndex < values.length - 1) {
        promptInfo.valueIndex = values.length - (values[values.length - 1] == '' ? 1 : 0);
      }
      values[promptInfo.valueIndex] =
        value.substring(0, promptInfo.charIndex) + key + value.substring(promptInfo.charIndex);
      promptInfo.charIndex++;
      redraw();
    };
  });
}
