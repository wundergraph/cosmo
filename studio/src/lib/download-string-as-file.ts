export const downloadStringAsFile = (
  content: string,
  filename: string,
  contentType: string
) => {
  // Create a Blob object with the content, and the specified content type
  let blob = new Blob([content], { type: contentType });

  // Create a URL for the blob object
  let url = URL.createObjectURL(blob);

  // Create a hidden anchor element
  let link = document.createElement("a");
  link.href = url;
  link.download = filename;

  // Append the anchor element to the document, and simulate a click
  document.body.appendChild(link);
  link.click();

  // Cleanup: remove the anchor element and revoke the blob URL
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
