document.addEventListener('DOMContentLoaded', function () {
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  var node
  while ((node = walker.nextNode())) {
    var text = node.textContent
    var formatted = text.replace(/(?<![/\d,])\d{4,}(?![/\d])/g, function (match) {
      return match.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
    })
    if (formatted !== text) {
      node.textContent = formatted
    }
  }
})
