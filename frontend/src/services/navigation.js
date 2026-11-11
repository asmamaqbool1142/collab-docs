/** Hash-based navigation: #/ → document list, #/doc/:id → editor. */
export const navigate = (path) => {
  window.location.hash = path;
};
