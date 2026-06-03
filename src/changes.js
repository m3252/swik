function fileChanges(changes) {
  return changes.filter((change) => change.path);
}

export {
  fileChanges
};
