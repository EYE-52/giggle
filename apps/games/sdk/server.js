'use strict';
/* Game Kit server entry (CommonJS): the reusable server side of the
 * framework — shared helpers, validation, and the existing engine
 * factories. No game rules are copied here; every factory below lives in
 * games/engines/* and is required, never forked. No bridge secrets, auth
 * tickets, room transport, or server internals are exported.
 *
 * Repo use:   const kit = require('./sdk/server.js');
 * Packed use: const kit = require('giggle-game-kit/server');
 * (The pack preserves repo-relative paths, so both resolve identically.) */

const KIT_VERSION = '0.1.38';

const sdk = require('../games/_sdk');
const validate = require('../games/_validate');
const kartEngine = require('../games/engines/kart-engine');
const kartMaps = require('../games/engines/kart-maps');
const kartBattle = require('../games/engines/kart-rules-battle');
const kartStarrush = require('../games/engines/kart-rules-starrush');
const cameraParty = require('../games/engines/camera-party');
const buildBattle = require('../games/engines/build-battle');
const blockSiege = require('../games/engines/block-siege');
const chainReaction = require('../games/engines/chain-reaction');
const englishDictionary = require('../games/engines/english-dictionary');
const semanticGuess = require('../games/engines/semantic-guess');
const wordHints = require('../games/engines/word-hints');

module.exports = {
  KIT_VERSION,
  sdk: {
    shuffle: sdk.shuffle,
    pick: sdk.pick,
    dealer: sdk.dealer,
    tally: sdk.tally,
    allIn: sdk.allIn,
    names: sdk.names,
    actionWindow: sdk.actionWindow,
  },
  validate: {
    LIMITS: validate.LIMITS,
    isValidId: validate.isValidId,
    manifestPlayers: validate.manifestPlayers,
    manifestSeats: validate.manifestSeats,
    activeIds: validate.activeIds,
    validateManifest: validate.validateManifest,
    defaultSettings: validate.defaultSettings,
    validateSettings: validate.validateSettings,
    validatePack: validate.validatePack,
    packCounts: validate.packCounts,
    clientSchema: validate.clientSchema,
  },
  kart: {
    createKartGame: kartEngine.createKartGame,
    RULES: kartEngine.RULES,
    constants: kartEngine.constants,
    helpers: kartEngine.helpers,
    maps: {
      MAPS: kartMaps.MAPS,
      mapIds: kartMaps.mapIds,
      mapDef: kartMaps.mapDef,
      normalizeMapId: kartMaps.normalizeMapId,
    },
    rules: { battle: kartBattle, starrush: kartStarrush },
  },
  camera: {
    createCameraParty: cameraParty.createCameraParty,
    normalizeSettings: cameraParty.normalizeSettings,
    captionFor: cameraParty.captionFor,
    promptText: cameraParty.promptText,
    majorityApproved: cameraParty.majorityApproved,
    readyBonus: cameraParty.readyBonus,
    BOUNDS: cameraParty.BOUNDS,
    REVEAL_MS: cameraParty.REVEAL_MS,
    BASE_POINTS: cameraParty.BASE_POINTS,
    READY_BONUS_MAX: cameraParty.READY_BONUS_MAX,
    CAPTION_MAX: cameraParty.CAPTION_MAX,
  },
  buildBattle: { createBuildBattle: buildBattle.createBuildBattle },
  blockSiege: {
    createBlockSiege: blockSiege.createBlockSiege,
    castlePositions: blockSiege.castlePositions,
    supported: blockSiege.supported,
    segmentBox: blockSiege.segmentBox,
  },
  chainReaction: {
    geometry: chainReaction.geometry,
    resolveCascade: chainReaction.resolveCascade,
    legalMoves: chainReaction.legalMoves,
    createChainReaction: chainReaction.createChainReaction,
  },
  dictionary: {
    createWordValidator: englishDictionary.createWordValidator,
    normalizeWord: englishDictionary.normalizeWord,
    isSubset: englishDictionary.isSubset,
    wordCount: englishDictionary.wordCount,
  },
  semantic: {
    cosine: semanticGuess.cosine,
    createEmbeddingProvider: semanticGuess.createEmbeddingProvider,
    createSemanticGuess: semanticGuess.createSemanticGuess,
    normalizeWord: semanticGuess.normalizeWord,
  },
  hints: {
    maskWord: wordHints.maskWord,
    hiddenLetters: wordHints.hiddenLetters,
    revealLetter: wordHints.revealLetter,
  },
};
