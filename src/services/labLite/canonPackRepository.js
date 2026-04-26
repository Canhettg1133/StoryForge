import {
  getCanonPackById,
  listCanonPacks,
  saveCanonPack,
} from './labLiteDb.js';

export async function persistCanonPack(pack) {
  return saveCanonPack(pack);
}

export async function loadCanonPack(canonPackId) {
  return getCanonPackById(canonPackId);
}

export async function listAvailableCanonPacks(corpusId = null) {
  return listCanonPacks(corpusId);
}
