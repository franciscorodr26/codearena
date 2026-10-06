function ratingTiers(ratings) {
  return ratings.map(r => r < 1000 ? 'Bronze' : r < 1400 ? 'Silver' : r < 1800 ? 'Gold' : r < 2200 ? 'Platinum' : 'Diamond')
}
