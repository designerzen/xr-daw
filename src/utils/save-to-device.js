export const downloadBlobOnClient = (blob, filename) => {
	var blobUrl = URL.createObjectURL(blob)
	var link = document.createElement("a")
	link.href = blobUrl
	link.download = filename
    link.innerText = "Click here to download the file"

    document.body.appendChild(link)
	link.click()

    // remove link after frame?
    setTimeout(() => {
        document.body.removeChild(link)
    },1)
}