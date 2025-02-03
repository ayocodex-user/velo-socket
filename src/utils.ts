export function timeFormatter(){
    const time = new Date().toLocaleString()
    const [datePart, _] = time.split(', ');
    let [month, day, year] = datePart.split('/')
    const formattedDate = year + '/' + month + '/' + day;
    return formattedDate;
  
}