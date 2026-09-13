document.getElementById('form').addEventListener('submit', function(event) {
    event.preventDefault(); // Prevent the default form submission
    const name = document.getElementById('name').value;
    const email = document.getElementById('email').value;
    const plan = document.getElementById('plan').value;

    alert(`Thank you for subscribing, ${name}! You have chosen the ${plan} plan. A confirmation email will be sent to ${email}.`);

    // Reset form after submission
    this.reset();
});