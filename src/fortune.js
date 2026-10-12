// Little fortunes for pets to share when you click them, like the Unix `fortune` command.
// If a `fortune` program is installed (for example through WSL, Scoop or MSYS2), floof uses
// its short, non-offensive sayings; otherwise it picks one of its own.
const { execFile } = require('child_process');

const OWN = [
  'A tidy desk is nice. A cat on the desk is nicer.',
  'Today is a good day to finish one small thing.',
  'The bug you are looking for is in the last place you look. Look there first.',
  'Drink some water. Your future self says thanks.',
  'Someone is proud of you for trying again.',
  'Every big project was once a folder called "new folder".',
  'Take a short walk. The answer often waits outside.',
  'A good commit message is a letter to a friend you have not met yet.',
  'You will soon close a tab you no longer need.',
  'Stretch your shoulders. Then stretch them again.',
  'The best time to save your work was five minutes ago. The second best is now.',
  'Kindness compiles on every platform.',
  'A sheep counts people when it cannot sleep.',
  'Small steps still go somewhere.',
  'Your next idea will arrive while you are making tea.',
  'Lucky number: the one in your next passing test.',
  'Ask the question. Most people are glad to help.',
  'Rest is part of the work.',
  'The dog thinks you are doing great.',
  'Clouds are just slow birds.',
  'A smile costs nothing and has no side effects.',
  'Today you will learn a keyboard shortcut and keep it forever.',
  'Write it down before it flies away.',
  'Fluffy things have strong opinions about naps.',
  'You are allowed to start over at any line.',
  'Somewhere a bird is singing just for practice.',
  'Good things come to those who refresh the page only once.',
  'An empty inbox is a rare and lovely flower.',
  'Patience: the progress bar is doing its best.',
  'The sun will come up tomorrow, with or without a stand-up meeting.',
  'Be the rubber duck you want to see in the world.',
  'A short break now saves a long one later.',
  'Your plants would like a word. The word is "water".',
  'Fortune favours the well-named variable.',
  'It is okay to not know yet.',
  'Three deep breaths fix more than you would think.',
  'Today a friendly message is on its way to you.',
  'The longest journey starts with a single "git init".',
  'Cats know that every box is the right size.',
  'Make something small and delightful today.',
  'A journey of a thousand miles begins with a single step.',
  'Fall seven times, stand up eight.',
  'The best time to plant a tree was twenty years ago. The second best time is now.',
  'Many hands make light work.',
  'Rome was not built in a day.',
  'Still waters run deep.',
  'Every cloud has a silver lining.',
  'A watched pot never boils. A watched build never finishes.',
  'Measure twice, cut once.',
  'Slow and steady wins the race.',
  'When the wind blows, some build walls and others build windmills.',
  'The early bird gets the worm, but the second mouse gets the cheese.',
  'Do not count your chickens before they hatch.',
  'Where there is a will, there is a way.',
  'You will find a missing semicolon in an unexpected place.',
  'A fresh cup of tea is closer than you think.',
  'Today is a good day to close a few browser tabs.',
  'Good things come to those who commit often.',
  'Someone, somewhere, is grateful for code you wrote.',
  'A nap is not laziness. It is a cache flush.',
  'Drink some water. Fluffy critters insist.',
  'An unexpected compliment is coming your way.',
  'The tests will pass on the first try. Today, at least.',
  'You are exactly where you need to be.',
  'Patience is also a form of progress.',
  'Every expert was once a beginner.',
  'A clean desk is a sign of a full drawer somewhere.',
  'Look out the window for a moment. The sky misses you.',
  'Not all who wander are lost. Some are just looking for snacks.',
  'Tomorrow you will be glad you wrote that comment today.',
  'Simple is better than clever.',
  'The longest README begins with a single line.',
  'A good question is half of the answer.',
  'Today you will help someone without even knowing it.',
  'Luck favours the well-rested.',
  'Your houseplants believe in you.',
  'Big things often have small beginnings.',
  'There is always one more bug, and one more fix.',
  'A smile is the shortest distance between two people.',
  'The cat sat on the keyboard and fixed everything. Probably.',
  'Sheep do not count people to fall asleep. Be kind to sheep.',
  'Birds of a feather push to the same branch.',
  'Every dog has its day. Today might be yours.',
  'Take the scenic route now and then.',
  'Fortune favours the curious.',
  'Even the tallest tower started on the ground floor.',
  'A little progress each day beats a lot of progress someday.',
  'You already know the answer. Go with it.',
  'Laughter is the best debugger.',
  'Something you lost will turn up soon.',
  'Good coffee and good friends: both worth waiting for.',
  'Breathe in. Breathe out. Ship it.',
  'Happiness is a warm, sunny windowsill.',
];

let program = null; // null = not checked yet, false = not installed, true = installed

function ownFortune() {
  return OWN[Math.floor(Math.random() * OWN.length)];
}

function runFortune() {
  return new Promise((resolve) => {
    // -s: short ones only. Without -o, fortune never picks from its offensive collection.
    execFile('fortune', ['-s'], { timeout: 1500, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      const text = String(stdout).replace(/\s+/g, ' ').trim();
      resolve(text && text.length <= 280 ? text : null);
    });
  });
}

async function getFortune() {
  if (program !== false) {
    const text = await runFortune();
    if (program === null) program = !!text;
    if (text) return text;
  }
  return ownFortune();
}

module.exports = { getFortune, ownFortune };
